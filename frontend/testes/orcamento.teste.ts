import type { Brutos, Grupo, Movimentacao } from "../src/api";
import { categoriasLimitaveis, limitesDoMes } from "../src/orcamento";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}
const igual = (a: unknown, b: unknown, nome: string) => ok(JSON.stringify(a) === JSON.stringify(b), nome, { veio: a, esperado: b });

const mov = (id: string, data: string, valor: number, extra: Partial<Movimentacao> = {}): Movimentacao =>
  ({ id, data, descricao: id, valor, natureza: valor < 0 ? "despesa" : "receita", conta_id: "c1", ...extra }) as Movimentacao;

const movs = [
  // Novembro (até o dia 10).
  mov("m1", "2026-11-02", -300, { categoria: "mercado" }),
  mov("m2", "2026-11-05", -150, { categoria: "mercado" }),
  mov("a1", "2026-11-03", -100, { categoria: "alimentacao", partes: [{ valor: -60, categoria: "alimentacao" }, { valor: -40, categoria: "lazer" }] }),
  mov("l1", "2026-11-08", -50, { categoria: "lazer" }),
  mov("s1", "2026-11-05", 3000, { categoria: "salario" }),
  // Compra do cartão na fatura de dezembro: não conta em novembro.
  mov("c1", "2026-11-09", -500, { categoria: "mercado", competencia: "2026-12" }),
  // Meses anteriores (média).
  mov("o1", "2026-10-10", -400, { categoria: "mercado" }),
  mov("o2", "2026-09-10", -350, { categoria: "mercado" }),
  mov("o3", "2026-08-10", -301, { categoria: "mercado" }),
  mov("t1", "2026-10-10", -900, { categoria: "transferencias" }),
];

const brutos = (extra: Partial<Brutos> = {}): Brutos =>
  ({
    movimentacoes: movs,
    categorias: [],
    categoriasMigradas: false,
    limites: [
      { categoria: "mercado", limite: 500 },
      { categoria: "alimentacao", limite: 600 },
      { categoria: "lazer", limite: 80 },
    ],
    ...extra,
  }) as unknown as Brutos;

const l = limitesDoMes(brutos(), "2026-11", "2026-11-10");
igual(
  l.map((x) => [x.categoria, x.gasto, x.pct, x.restante, x.situacao]),
  [
    ["lazer", 90, 113, -10, "passou"],
    ["mercado", 450, 90, 50, "perto"],
    ["alimentacao", 60, 10, 540, "ok"],
  ],
  "limites: gasto do mês com partes, sem a fatura seguinte, do mais apertado ao mais folgado",
);
igual(l.find((x) => x.categoria === "mercado")!.previsto, 1350, "previsto no fim do mês pelo ritmo (450 em 10 dias × 30)");
igual(l[0].nome, "Lazer", "nome da categoria antiga");

// No ritmo, vai passar (mas ainda abaixo de 80%).
const ritmo = limitesDoMes(brutos({ limites: [{ categoria: "mercado", limite: 1000 }] }), "2026-11", "2026-11-10");
igual(ritmo[0].situacao, "vai_passar", "450 em 10 dias → 1.350 no mês: vai passar do limite de 1.000");
igual(limitesDoMes(brutos({ limites: [{ categoria: "mercado", limite: 1000 }] }), "2026-11", "2026-11-03")[0].situacao, "ok", "antes do dia 5 não prevê");
igual(limitesDoMes(brutos(), "2026-10", "2026-11-10").find((x) => x.categoria === "mercado")!.previsto, null, "mês passado não tem previsão");
igual(limitesDoMes(brutos({ limites: [] }), "2026-11", "2026-11-10"), [], "sem limites");

// Categorias para escolher limite.
const c = categoriasLimitaveis(brutos({ limites: [{ categoria: "lazer", limite: 80 }] }), "2026-11");
igual(
  c.map((x) => [x.categoria, x.media, x.sugestao, x.limite]),
  [
    ["mercado", 350.33, 360, null],
    ["lazer", 0, null, 80],
  ],
  "limitáveis: com gasto nos 3 meses anteriores (sem transferências) e as que têm limite",
);

// Depois de migrar: os grupos de gasto, com nome e cor do grupo.
const grupos = [
  { id: "mercado", nome: "Supermercado", tipo: "gasto", cor: "g2" },
  { id: "g_sal", nome: "Salário", tipo: "entrada", cor: "g4" },
  { id: "casa", nome: "Casa", tipo: "gasto", cor: "g1" },
] as Grupo[];
const migrado = brutos({ categorias: grupos as unknown as Brutos["categorias"], categoriasMigradas: true, limites: [] });
igual(
  categoriasLimitaveis(migrado, "2026-11").map((x) => [x.categoria, x.nome, x.cor]),
  [
    ["mercado", "Supermercado", "g2"],
    ["casa", "Casa", "g1"],
  ],
  "limitáveis depois de migrar: só grupos de gasto",
);

if (falhas) {
  console.error(`${falhas} teste(s) falharam`);
  process.exit(1);
}
console.log("todos passaram");
