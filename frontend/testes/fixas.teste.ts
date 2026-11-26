import { nomeLimpo, sugestoes } from "../src/fixas";
import { lugar } from "../src/gastos";
import casos from "./casos/fixas.json";

// Os mesmos casos rodam no servidor (backend/src/fixas.rs): as duas pontas têm de concordar.
let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}

for (const c of casos.lugar) {
  const r = lugar(c.entrada);
  ok(r === c.saida, `lugar "${c.entrada}"`, r);
}
for (const c of casos.nome_limpo) {
  const r = nomeLimpo(c.entrada);
  ok(r === c.saida, `nomeLimpo "${c.entrada}"`, r);
}
for (const c of casos.sugestoes) {
  const r = sugestoes(c.movs as never, c.fixas as never, c.mes_atual, new Map(), c.ignoradas, c.categorias as never).map((s) => s.chave);
  ok(JSON.stringify(r) === JSON.stringify(c.chaves_esperadas), `sugestões: ${c.nome}`, r);
}

if (falhas) {
  console.error(`${falhas} falha(s)`);
  process.exit(1);
}
