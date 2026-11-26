// Avisos no celular (notificações push): permissão, assinatura e limpeza ao sair.
// "./api" é carregado só quando preciso: os testes importam as funções puras sem o ambiente do Vite.
const api = async () => (await import("./api")).api;

/** Converte base64url (como a chave pública do servidor) em bytes. */
export function chaveParaBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Os dois conjuntos de bytes são iguais? (`null` = indisponível, conta como diferente.) */
export function mesmaChave(a: ArrayBuffer | Uint8Array | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = a instanceof Uint8Array ? a : new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/** Nome curto do aparelho para a lista, a partir do user agent. Ex.: "Chrome · Android". */
export function nomeDoAparelho(ua: string): string {
  const navegador = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser\//.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "";
  const sistema = /iPhone|iPod/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux|X11/.test(ua)
              ? "Linux"
              : "";
  return [navegador, sistema].filter(Boolean).join(" · ") || "Aparelho";
}

export function suportado(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Mesmo id que o servidor usa: 16 primeiros caracteres hex do SHA-256 do endereço. */
export async function idDoEndpoint(endpoint: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** O service worker só existe no app publicado; no desenvolvimento não há registro. */
async function registroDoServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!suportado()) return null;
  const pronto = navigator.serviceWorker.ready;
  const limite = new Promise<null>((r) => setTimeout(() => r(null), 4000));
  return Promise.race([pronto, limite]);
}

/** Aparelho já assinado? Devolve o id (para marcar "este aparelho" na lista) ou null. */
export async function idDesteAparelho(): Promise<string | null> {
  try {
    const reg = await registroDoServiceWorker();
    const s = await reg?.pushManager.getSubscription();
    return s ? await idDoEndpoint(s.endpoint) : null;
  } catch {
    return null;
  }
}

/** Pede permissão, assina no navegador e registra o aparelho no servidor. */
export async function ativar(chavePublica: string): Promise<"ativado" | "negado" | "sem_suporte"> {
  if (!suportado()) return "sem_suporte";
  const reg = await registroDoServiceWorker();
  if (!reg) return "sem_suporte";
  const permissao = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permissao !== "granted") return "negado";
  const chave = chaveParaBytes(chavePublica);
  let sub = await reg.pushManager.getSubscription();
  // Assinatura feita com outra chave do servidor não recebe nada: cancela e assina de novo.
  if (sub && !mesmaChave(sub.options?.applicationServerKey, chave)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave as BufferSource });
  const { endpoint, keys } = sub.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error("o navegador não devolveu os dados da assinatura");
  await (await api()).registrarAparelho({ endpoint, p256dh: keys.p256dh, auth: keys.auth, nome: nomeDoAparelho(navigator.userAgent) });
  return "ativado";
}

/**
 * Tira este aparelho dos avisos.
 * Padrão (botão Desativar): servidor primeiro; a assinatura local é cancelada mesmo se o servidor falhar
 * (o erro do servidor é repassado depois).
 * `aoSair`: cancela a assinatura local ANTES e tenta o servidor em seguida, sem se importar se falhar:
 * assim, mesmo sem internet, o aparelho deixa de receber avisos de quem saiu.
 */
export async function desativarEste(aoSair = false): Promise<void> {
  const reg = await registroDoServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const id = await idDoEndpoint(sub.endpoint);
  if (aoSair) {
    await sub.unsubscribe().catch(() => {});
    await (await api()).removerAparelho(id).catch(() => {});
    return;
  }
  try {
    await (await api()).removerAparelho(id);
  } finally {
    await sub.unsubscribe().catch(() => {});
  }
}
