import type { Brutos, Fixa, Holerite, Movimentacao } from "../src/api";
import { previsao, salarioPrevisto } from "../src/previsao";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}
const igual = (a: unknown, b: unknown, nome: string) => ok(JSON.stringify(a) === JSON.stringify(b), nome, { veio: a, esperado: b });

const HOJE = "2026-11-23";
const mov = (id: string, data: string, valor: number, extra: Partial<Movimentacao> = {}): Movimentacao =>
  ({ id, data, descricao: id.toUpperCase(), valor, natureza: valor < 0 ? "despesa" : "receita", conta_id: "cc", ...extra }) as Movimentacao;
const salario = (mes: string, dia: string, valor: number) => mov(`sal${mes}`, `${mes}-${dia}`, valor, { categoria: "salario", descricao: "LIQUIDO DE VENCIMENTO" });
const fixa = (id: string, valor: number, dia: number, forma: Fixa["forma"], extra: Partial<Fixa> = {}): Fixa => ({ id, nome: id, valor, dia, forma, ativa: true, pagos: [], ...extra });

const brutos = (extra: Partial<Brutos> = {}): Brutos =>
  ({
    holerites: [],
    movimentacoes: [salario("2026-09", "04", 3058), salario("2026-10", "06", 953), salario("2026-11", "06", 3111)],
    dividas: [],
    dividasTipos: [],
    dividasRecusados: [],
    documentos: [],
    descontosTemporarios: [],
    contas: [
      { id: "cc", tipo: "corrente", apelido: "Conta" },
      { id: "res", tipo: "corrente", apelido: "Reserva", papel: "reserva" },
      { id: "cartao", tipo: "cartao", apelido: "Cartão" },
    ],
    emprestimos: [],
    categorias: [],
    categoriasMigradas: false,
    metas: [],
    fixas: [],
    ...extra,
  }) as unknown as Brutos;

// ---------- salário previsto ----------

igual(salarioPrevisto(brutos(), HOJE), { dia: "2026-12-07", valor: 3058, pelo: "historico" }, "salário: mediana dos 3 últimos, dia 06 de dezembro cai num domingo → segunda 07/12");
igual(
  salarioPrevisto(brutos({ holerites: [{ id: "h", competencia: "2026-11", data_pagamento: "2026-12-04", liquido: 3200 } as Holerite] }), HOJE),
  { dia: "2026-12-04", valor: 3200, pelo: "holerite" },
  "salário: holerite com pagamento futuro vence o histórico",
);
igual(salarioPrevisto(brutos({ movimentacoes: [] }), HOJE), null, "sem salário no histórico");
igual(salarioPrevisto(brutos({ movimentacoes: [salario("2026-07", "06", 3000)] }), HOJE), null, "salário antigo demais (mais de 75 dias) não conta");
// Salário de grupo próprio (categorias já migradas): o nome do grupo é "Salário".
igual(
  salarioPrevisto(brutos({ movimentacoes: [mov("s", "2026-11-06", 3000, { categoria: "g_sal" })], categorias: [{ id: "g_sal", nome: "Salário" }] as Brutos["categorias"] }), HOJE)?.valor,
  3000,
  "salário pelo nome do grupo",
);

// ---------- previsão ----------

const b = brutos({
  fixas: [
    fixa("Internet", 100, 28, "pix"),
    fixa("Spotify", 40.9, 7, "cartao"), // vai na fatura: não sai da conta
    fixa("Luz", 200, 2, "boleto"), // dia 2 de novembro já passou sem pagar: atrasada, conta hoje
    fixa("Água", 80, 15, "boleto", { pagos: ["2026-11"] }), // paga em novembro: só a de dezembro
  ],
});
const p = previsao(b, { saldo: 1000, faturas: [{ dia: "2026-12-07", valor: 2224.67, nome: "Fatura do cartão" }] }, HOJE, 30);

igual(p.ate, "2026-12-07", "até o salário (a fatura vence no mesmo dia)");
igual(
  p.eventos.map((e) => [e.dia, e.nome, e.valor]),
  [
    ["2026-11-23", "Luz", -200],
    ["2026-11-28", "Internet", -100],
    ["2026-12-02", "Luz", -200],
    ["2026-12-07", "Salário", 3058],
    ["2026-12-07", "Fatura do cartão", -2224.67],
    ["2026-12-15", "Água", -80],
  ],
  "eventos: fixas fora do cartão, atrasada hoje, salário antes da fatura no mesmo dia",
);
// Sem gastar nada: 1000 −200 (hoje) −100 (28/11) −200 (02/12) = 500 até 06/12 (14 dias de 23/11 a 06/12).
// Em 07/12: 500 + 3058 − 2224,67 = 1333,33 em 15 dias. O aperto é 06/12: 500 / 14 = 35,71.
igual(p.porDia, 35.71, "pode gastar por dia: o pior ponto antes do salário");
igual(p.aperto, { dia: "2026-12-06", saldo: 500 }, "aperto antes do salário");
igual(p.falta, null, "não falta");
igual(p.serie.length, 31, "série de hoje até 30 dias depois");
igual(p.serie[0], { dia: "2026-11-23", saldo: 800 }, "série começa hoje, já com a conta atrasada (sem gasto do dia a dia: nada no histórico)");

// Gasto médio da conta nos últimos 60 dias entra na série, não no "pode gastar".
const comGastos = brutos({
  movimentacoes: [...brutos().movimentacoes, mov("m1", "2026-10-30", -300), mov("m2", "2026-11-10", -300), mov("pc", "2026-11-11", -500, { parcela: "01/02" }), mov("rv", "2026-11-12", -999, { conta_id: "res" })],
});
const q = previsao(comGastos, { saldo: 1000, faturas: [] }, HOJE, 30);
igual(q.diaADia, 10, "dia a dia: gastos variáveis da conta (sem parcela nem reserva) / 60 dias");
igual(q.serie[1], { dia: "2026-11-24", saldo: 980 }, "série desconta o dia a dia");
igual(q.negativo, null, "sem dia negativo");

// Falta mesmo sem gastar nada.
const r = previsao(brutos(), { saldo: 100, faturas: [{ dia: "2026-12-01", valor: 600, nome: "Fatura do cartão" }] }, HOJE, 20);
igual(r.falta, { dia: "2026-12-01", valor: 500 }, "falta R$ 500 no dia da fatura");
igual(r.porDia, 0, "sem dinheiro para o dia a dia");
igual(r.negativo, "2026-12-01", "primeiro dia negativo na série");

// Sem salário previsto: até o fim do mês.
igual(previsao(brutos({ movimentacoes: [] }), { saldo: 80, faturas: [] }, HOJE, 30).ate, "2026-11-30", "sem salário: até o fim do mês");

if (falhas) {
  console.error(`${falhas} teste(s) falharam`);
  process.exit(1);
}
console.log("todos passaram");
