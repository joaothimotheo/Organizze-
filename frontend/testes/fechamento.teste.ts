import type { Brutos } from "../src/api";
import { mesDoFechamento, resumoDoMes } from "../src/fechamento";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}

let n = 0;
const mov = (data: string, valor: number, natureza: string, categoria: string | null = null, extra: object = {}) => ({
  id: `m${++n}`,
  data,
  descricao: `lanc ${n}`,
  valor,
  natureza,
  categoria,
  ...extra,
});
const grupo = (id: string, nome: string) => ({ id, nome, tipo: "gasto", cor: null, oculta: false });

const brutos = (movimentacoes: object[], fixas: object[] = [], contas: object[] = []) =>
  ({
    movimentacoes,
    categorias: [grupo("mercado", "Mercado"), grupo("transporte", "Transporte"), grupo("lazer", "Lazer"), grupo("saude", "Saúde"), grupo("casa", "Casa"), grupo("queda", "Queda")],
    fixas,
    contas,
    saldosContas: [],
    holerites: [],
    dividas: [],
  }) as unknown as Brutos;

// Setembro (anterior) e outubro (fechado).
const movs = [
  mov("2026-09-05", 5000, "receita"),
  mov("2026-09-10", -800, "despesa", "mercado"),
  mov("2026-09-11", -350, "despesa", "transporte"),
  mov("2026-09-12", -260, "despesa", "lazer"),
  mov("2026-09-13", -90, "despesa", "saude"),
  mov("2026-09-14", -500, "despesa", "queda"),
  mov("2026-10-05", 6000, "receita"),
  mov("2026-10-10", -1000, "despesa", "mercado"), // +200
  mov("2026-10-11", -500, "despesa", "transporte"), // +150
  mov("2026-10-12", -300, "despesa", "lazer"), // +40
  mov("2026-10-13", -250, "despesa", "saude"), // +150
  mov("2026-10-14", -200, "despesa", "queda"), // caiu
  mov("2026-10-15", -400, "pagamento_divida"),
  mov("2026-10-16", -100, "despesa", "casa"), // categoria nova: cresceu do zero, mas só a 4ª maior alta fica fora
  mov("2026-10-20", 200, "transferencia", null, { conta_id: "res" }),
  mov("2026-10-21", 30, "transferencia", null, { conta_id: "res" }),
  mov("2026-10-22", 1, "transferencia", null, { conta_id: "res", descricao: "Rendimentos" }),
  mov("2026-10-25", -99.9, "despesa", "lazer", { descricao: "ACADEMIA XYZ" }),
  mov("2026-10-26", -50, "despesa", "lazer", { descricao: "NETFLIX" }),
];
const fixas = [
  { id: "f1", nome: "Netflix", valor: 50, dia: 26, forma: "cartao", ativa: true, busca: "netflix" },
  { id: "f2", nome: "Academia", valor: 99.9, dia: 28, forma: "boleto", ativa: true, busca: "outra coisa" },
  { id: "f3", nome: "Aluguel", valor: 1500, dia: 5, forma: "boleto", ativa: true, pagos: ["2026-10"] },
  { id: "f4", nome: "Antiga", valor: 10, forma: "boleto", ativa: false },
];
const contas = [{ id: "res", papel: "reserva" }, { id: "cc", papel: null }];

const r = resumoDoMes(brutos(movs, fixas, contas), "2026-10");
ok(r.mes === "2026-10" && !r.vazio, "mês e não vazio", r);
ok(r.entrou === 6000, "entrou", r.entrou);
ok(Math.abs(r.saiu - 2499.9) < 0.005, "saiu", r.saiu);
ok(Math.abs(r.sobra - 3500.1) < 0.005, "sobra", r.sobra);
ok(r.dividas === 400, "dívidas pagas", r.dividas);
ok(r.guardado === 230, "guardado na reserva (sem rendimento)", r.guardado);
ok(r.cresceram.length === 3, "top 3", r.cresceram);
ok(r.cresceram.map((c) => c.nome).join() === "Mercado,Lazer,Saúde", "ordem pelo aumento", r.cresceram);
ok(r.cresceram[0].valor === 1000 && r.cresceram[0].diferenca === 200, "valor e diferença", r.cresceram[0]);
ok(!r.cresceram.some((c) => c.nome === "Queda" || c.nome === "Transporte"), "categoria que caiu e a 4ª maior alta ficam fora");
ok(r.fixas.total === 3 && r.fixas.pagas === 2, "fixas pagas (banco e marcada) de 3 ativas", r.fixas);
ok(r.fixas.faltaram.length === 1 && r.fixas.faltaram[0].nome === "Academia" && r.fixas.faltaram[0].valor === 99.9, "fixa não paga", r.fixas.faltaram);

const v = resumoDoMes(brutos(movs, fixas, contas), "2026-07");
ok(v.vazio && v.entrou === 0 && v.saiu === 0 && v.sobra === 0 && v.dividas === 0 && v.guardado === 0 && !v.cresceram.length, "mês sem lançamentos", v);

const vinc = resumoDoMes(brutos([mov("2026-10-05", 100, "receita"), mov("2026-10-06", -80, "despesa", "casa", { descricao: "BOLETO QUALQUER", vinculo: { tipo: "fixa", id: "fx", mes: "2026-10" } })], [{ id: "fx", nome: "Condomínio", valor: 80, forma: "boleto", ativa: true }]), "2026-10");
ok(vinc.fixas.pagas === 1 && vinc.fixas.faltaram.length === 0, "fixa paga só por vínculo conta como paga", vinc.fixas);

const doZero = resumoDoMes(brutos([mov("2026-09-05", -100, "despesa", "mercado"), mov("2026-10-05", -100, "despesa", "mercado"), mov("2026-10-06", -70, "despesa", "casa")]), "2026-10");
ok(doZero.cresceram.length === 1 && doZero.cresceram[0].nome === "Casa" && doZero.cresceram[0].diferenca === 70 && !doZero.semGastoAnterior, "categoria que cresceu do zero aparece", doZero);

const poucos = resumoDoMes(brutos([mov("2026-10-05", 100, "receita")]), "2026-10");
ok(!poucos.vazio && poucos.cresceram.length === 0 && poucos.semGastoAnterior, "sem gasto no mês anterior: nada a comparar", poucos);

ok(mesDoFechamento(null, "2026-11-19") === "2026-10", "sem detalhe: mês anterior");
ok(mesDoFechamento("2026-11", "2026-11-19") === "2026-10", "mês atual não vale");
ok(mesDoFechamento("2027-01", "2026-11-19") === "2026-10", "mês futuro não vale");
ok(mesDoFechamento("lixo", "2026-11-19") === "2026-10", "lixo: mês anterior");
ok(mesDoFechamento("2026-13", "2026-11-19") === "2026-10", "mês 13 inválido");
ok(mesDoFechamento("2026-08", "2026-11-19") === "2026-08", "mês passado vale");
ok(mesDoFechamento(null, "2027-01-03") === "2026-12", "virada de ano");

if (falhas) {
  console.error(`${falhas} falha(s)`);
  process.exit(1);
}
