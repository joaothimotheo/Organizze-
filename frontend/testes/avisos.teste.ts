import { chaveParaBytes, mesmaChave, idDoEndpoint, nomeDoAparelho } from "../src/avisos";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}

const chromeAndroid = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const chromeWindows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const safariIphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const edgeWindows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
ok(nomeDoAparelho(chromeAndroid) === "Chrome · Android", "Chrome Android", nomeDoAparelho(chromeAndroid));
ok(nomeDoAparelho(chromeWindows) === "Chrome · Windows", "Chrome Windows", nomeDoAparelho(chromeWindows));
ok(nomeDoAparelho(safariIphone) === "Safari · iPhone", "Safari iPhone", nomeDoAparelho(safariIphone));
ok(nomeDoAparelho(edgeWindows) === "Edge · Windows", "Edge Windows", nomeDoAparelho(edgeWindows));
ok(nomeDoAparelho("") === "Aparelho", "UA vazio");

// Chave pública P-256 não comprimida: 65 bytes começando em 0x04.
const bruta = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : (i * 7) % 256));
const b64url = Buffer.from(bruta).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const volta = chaveParaBytes(b64url);
ok(volta.length === 65 && volta[0] === 4, "chave de 65 bytes", volta.length);
ok(Buffer.from(volta).equals(Buffer.from(bruta)), "bytes idênticos");
ok(mesmaChave(bruta.buffer, volta), "mesmaChave: iguais");
ok(!mesmaChave(null, volta) && !mesmaChave(undefined, volta), "mesmaChave: indisponível");
ok(!mesmaChave(new Uint8Array(65).buffer, volta), "mesmaChave: diferentes");
ok(!mesmaChave(new Uint8Array(64), volta), "mesmaChave: tamanhos diferentes");
// Mesmo id do servidor: 16 primeiros hex do sha256 (valor conferido com `shasum -a 256`).
void idDoEndpoint("https://fcm.googleapis.com/fcm/send/abc").then((id) => {
  ok(id === "4e9bdab8bbe7189c", "idDoEndpoint igual ao do servidor", id);
  if (falhas) process.exit(1);
});
