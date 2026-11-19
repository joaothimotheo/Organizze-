// Instalação como aplicativo (PWA).
// O service worker guarda só a casca do app; os dados financeiros vêm sempre do servidor.

type EventoInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let pedidoInstalar: EventoInstalar | null = null;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

export function registrarPwa() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    pedidoInstalar = e as EventoInstalar;
    avisar();
  });
  window.addEventListener("appinstalled", () => {
    pedidoInstalar = null;
    avisar();
  });
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* sem service worker o sistema funciona igual, só não instala */
      });
    });
  }
}

export function aoMudarInstalacao(f: () => void) {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
}

export const instalado = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const podeInstalar = () => pedidoInstalar !== null;

/** iPhone/iPad não têm botão de instalar: é pelo Compartilhar → Adicionar à Tela de Início. */
export const ehIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export async function instalar() {
  const p = pedidoInstalar;
  if (!p) return;
  await p.prompt();
  await p.userChoice.catch(() => null);
  pedidoInstalar = null;
  avisar();
}

/** Ao sair, pede ao service worker para apagar o que tiver guardado. */
export function limparCacheLocal() {
  navigator.serviceWorker?.controller?.postMessage("limpar");
}
