/* Service worker do Financeiro.
 *
 * Guarda no aparelho SÓ a casca do aplicativo (HTML, JS, CSS, ícones), para abrir rápido
 * e funcionar como app instalado. Nada de /api/* passa por aqui: saldos, holerites,
 * faturas e PDFs nunca são gravados no cache do navegador. Sem internet, o app abre
 * e avisa que precisa de conexão para mostrar os dados.
 *
 * VERSAO e ARQUIVOS são preenchidos no build (vite.config.ts).
 */
const VERSAO = "__VERSAO__";
const ARQUIVOS = __ARQUIVOS__;
const CACHE = "casca-" + VERSAO;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ARQUIVOS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  // Ao sair, a página pede para limpar tudo (a casca não tem dados, mas não custa).
  if (e.data === "limpar") e.waitUntil(caches.keys().then((n) => Promise.all(n.map((x) => caches.delete(x)))));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fontes do Google etc.: o navegador cuida
  if (url.pathname.startsWith("/api/")) return; // dados financeiros: sempre da rede, nunca em cache

  if (req.mode === "navigate") {
    // HTML: tenta a rede primeiro (para pegar versões novas); sem rede, usa a casca guardada.
    e.respondWith(fetch(req).catch(() => caches.match("/index.html").then((r) => r || Response.error())));
    return;
  }
  // Arquivos com hash no nome não mudam: cache primeiro.
  e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
