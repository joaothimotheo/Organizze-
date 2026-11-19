import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Preenche o service worker com a lista de arquivos do build e uma versão derivada deles.
// Assim cada publicação troca o cache da casca do app, e os dados (/api) nunca entram nele.
function serviceWorker(): Plugin {
  let arquivos: string[] = [];
  let saida = "dist";
  return {
    name: "financeiro-sw",
    apply: "build",
    configResolved(c) {
      saida = resolve(c.root, c.build.outDir);
    },
    generateBundle(_, bundle) {
      arquivos = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
    },
    closeBundle() {
      const publicos = ["icone.svg", "icone-180.png", "icone-192.png", "icone-512.png", "manifest.webmanifest"];
      const lista = ["/index.html", ...[...arquivos.filter((f) => f !== "index.html"), ...publicos].map((f) => "/" + f)];
      const versao = createHash("sha256").update(lista.join("\n")).digest("hex").slice(0, 12);
      const caminho = resolve(saida, "sw.js");
      const sw = readFileSync(caminho, "utf8").replace("__VERSAO__", versao).replace("__ARQUIVOS__", JSON.stringify(lista));
      writeFileSync(caminho, sw);
    },
  };
}

// Em desenvolvimento, /api vai para o back-end Rust.
export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: { proxy: { "/api": "http://127.0.0.1:8080" } },
});
