import type { Brutos, Divida, Emprestimo, Movimentacao } from "../src/api";
import { juntarDividas, mesDaProjecao, projetar, resumo } from "../src/dividas";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}
const perto = (a: number | null | undefined, b: number, tol = 0.01) => a != null && Math.abs(a - b) <= tol;
const vp = (p: number, i: number, n: number) => (i > 0 ? (p * (1 - Math.pow(1 + i, -n))) / i : p * n);

const HOJE = "2026-11-21";

const div = (id: string, extra: Partial<Divida>): Divida => ({ id, credor: id, nome: id, situacao: "ativa", origem: { tipo: "informado" }, saldos: [], ...extra });

const brutos = (extra: Partial<Brutos> = {}): Brutos =>
  ({
    holerites: [],
    movimentacoes: [],
    dividas: [],
    dividasTipos: [],
    dividasRecusados: [],
    documentos: [],
    descontosTemporarios: [],
    contas: [],
    emprestimos: [],
    categorias: [],
    metas: [],
    fixas: [],
    saldosContas: [],
    fixasIgnoradas: [],
    categoriasMigradas: true,
    ...extra,
  }) as Brutos;

const comDivida = (extra: Partial<Divida>, b: Partial<Brutos> = {}) => brutos({ dividas: [div("d1", extra)], ...b });

// com juros
{
  const p = projetar(comDivida({ parcela_valor: 412.8, parcelas_restantes: 9, proximo_vencimento: "2026-12-10", taxa_mensal: 6.3, saldos: [{ data: "2026-11-01", saldo_devedor: 3000 }] }), "2027-03", HOJE);
  const it = p.itens[0];
  ok(p.itens.length === 1 && p.quitadas.length === 0, "com juros: um item");
  ok(it.faltam === 5, "com juros: faltam 5", it?.faltam);
  ok(perto(it.saldo, 412.8 * 5), "com juros: saldo nominal 2064,00", it?.saldo);
  ok(perto(it.parcelaDoMes, 412.8), "com juros: parcela do mês");
  ok(perto(p.deve, 2064) && perto(p.parcelasDoMes, 412.8), "com juros: totais");
  ok(p.mes === "2027-03", "com juros: mês");
}
// sem juros
{
  const p = projetar(comDivida({ parcela_valor: 100, parcelas_restantes: 6, proximo_vencimento: "2026-12-05", saldos: [{ data: "2026-11-01", saldo_devedor: 600 }] }), "2027-02", HOJE);
  ok(p.itens[0]?.faltam === 3 && perto(p.itens[0].saldo, 300), "sem juros: faltam 3 e saldo 300", p.itens[0]);
}
// quitada antes
{
  const p = projetar(comDivida({ parcela_valor: 100, parcelas_restantes: 2, proximo_vencimento: "2026-12-05" }), "2027-03", HOJE);
  ok(p.itens.length === 0 && p.quitadas.length === 1 && p.quitadas[0].quitadaEm === "2027-01", "quitada antes", p.quitadas);
  ok(perto(p.parcelasDoMes, 0) && perto(p.deve, 0), "quitada antes: sem parcela nem saldo");
}
// última parcela no mês
{
  const p = projetar(comDivida({ parcela_valor: 100, parcelas_restantes: 4, proximo_vencimento: "2026-12-05" }), "2027-03", HOJE);
  ok(p.itens.length === 0 && p.quitadas[0]?.quitadaEm === "2027-03", "última parcela: quitada em 2027-03", p.quitadas);
  ok(perto(p.parcelasDoMes, 100), "última parcela: soma a parcela do mês", p.parcelasDoMes);
}
// atrasada
{
  const p = projetar(comDivida({ parcela_valor: 100, parcelas_restantes: 5, proximo_vencimento: "2026-10-05" }), "2027-01", HOJE);
  ok(p.itens[0]?.faltam === 1 && perto(p.itens[0].saldo, 100), "atrasada: faltam 1", p.itens[0]);
}
// antes do início: nada pago, sem parcela no mês
{
  const p = projetar(comDivida({ parcela_valor: 100, parcelas_restantes: 3, proximo_vencimento: "2027-02-05" }), "2027-01", HOJE);
  ok(p.itens[0]?.faltam === 3 && perto(p.itens[0].parcelaDoMes, 0), "antes do início: faltam 3, parcela 0", p.itens[0]);
}
// cartão por mês
{
  const k = (id: string, parcela: string, comp: string) =>
    ({ id, data: `${comp}-03`, descricao: "LOJA X", valor: -150, natureza: "despesa", conta_id: "cc", parcela, competencia: comp, data_compra: "2026-09-03", origem: { cartao_final: "1234" } }) as unknown as Movimentacao;
  // Fatura de novembro aberta com a parcela 8/10: faltam 3, de 2026-12 a 2027-02.
  const b = brutos({ movimentacoes: [k("k1", "8/10", "2026-11")] });
  const v = juntarDividas(b, HOJE).find((x) => x.origem === "cartao");
  ok(!!v && v.proxima!.data === "2026-12" && v.fim === "2027-02" && v.restantes === 3, "cartão: próxima 2026-12, fim 2027-02", v);
  const p = projetar(b, "2027-01", HOJE);
  const it = p.itens.find((i) => i.divida.origem === "cartao");
  ok(!!it && p.quitadas.length === 0, "cartão: em itens em 2027-01", p);
  ok(!!it && perto(it.parcelaDoMes, 150) && it.faltam === 1 && perto(it.saldo, 150), "cartão: parcela do mês, faltam 1, saldo = parcela", it);
  const fim = projetar(b, v?.fim ?? "2027-02", HOJE);
  ok(fim.quitadas.length === 1 && fim.quitadas[0].quitadaEm === "2027-02" && perto(fim.parcelasDoMes, 150), "cartão: quitada no mês do fim", fim);
}
// sem data (pessoa)
{
  const emp: Emprestimo[] = [{ id: "e1", pessoa: "João", direcao: "eu_devo", valor: 1000, data: "2026-06-01", pagamentos: [{ id: "pg1", data: "2026-08-01", valor: 300 }], situacao: "aberto" } as Emprestimo];
  const b = brutos({ emprestimos: emp });
  const v = juntarDividas(b, HOJE)[0];
  const p = projetar(b, "2027-05", HOJE);
  ok(p.itens[0]?.faltam === null && perto(p.itens[0].saldo, v.ateOFim) && perto(p.itens[0].parcelaDoMes, 0), "sem data: saldo = ateOFim, faltam null", p.itens[0]);
}
// totais de hoje, peso e ordem
{
  const b = comDivida({ parcela_valor: 100, parcelas_restantes: 4, proximo_vencimento: "2026-12-05" }, { holerites: [{ id: "h", competencia: "2026-10", proventos: [], descontos: [], bruto: 2000, total_descontos: 0, liquido: 2000 } as never] });
  const p = projetar(b, "2027-01", HOJE);
  const r = resumo(juntarDividas(b, HOJE), b, HOJE);
  ok(perto(p.deveHoje, r.deve), "deveHoje = resumo.deve", [p.deveHoje, r.deve]);
  ok(p.peso !== null && perto(p.peso, 100 / 2000, 1e-6), "peso", p.peso);
  const sem = projetar(comDivida({ parcela_valor: 100, parcelas_restantes: 4, proximo_vencimento: "2026-12-05" }), "2027-01", HOJE);
  ok(sem.peso === null, "peso nulo sem salário");
}
// sem vencimento: começa no mês seguinte, como resumo
{
  const b = comDivida({ parcela_valor: 100, parcelas_restantes: 4 });
  const fimRes = juntarDividas(b, HOJE)[0]?.fim;
  ok(fimRes === "2027-03", "sem vencimento: fim 2027-03", fimRes);
  const dez = projetar(b, "2026-12", HOJE);
  ok(dez.itens[0]?.faltam === 3 && perto(dez.parcelasDoMes, 100), "sem vencimento: dezembro faltam 3", dez.itens[0]?.faltam);
  const fev = projetar(b, "2027-02", HOJE);
  ok(fev.itens[0]?.faltam === 1 && fev.quitadas.length === 0, "sem vencimento: fevereiro faltam 1, não quitada", fev.itens[0]?.faltam);
  const mar = projetar(b, "2027-03", HOJE);
  ok(mar.itens.length === 0 && mar.quitadas.length === 1 && mar.quitadas[0].quitadaEm === "2027-03" && perto(mar.parcelasDoMes, 100), "sem vencimento: março quitada em 2027-03 e parcela somada", mar.quitadas);
  const abr = projetar(b, "2027-04", HOJE);
  ok(perto(abr.parcelasDoMes, 0) && abr.quitadas.length === 1, "sem vencimento: abril parcela 0", abr.parcelasDoMes);
}
// vista projetada (formato da tela de hoje)
{
  const p = projetar(comDivida({ parcela_valor: 412.8, parcelas_restantes: 9, parcelas_total: 12, proximo_vencimento: "2026-12-10", taxa_mensal: 6.3, saldos: [{ data: "2026-11-01", saldo_devedor: 3000 }] }), "2027-03", HOJE);
  const v = p.itens[0].vista;
  ok(v.pagas === 7 && v.restantes === 5, "vista: pagas 7, restantes 5", v);
  ok(v.proxima?.data === "2027-03" && perto(v.proxima.valor, 412.8), "vista: próxima é a parcela do mês", v.proxima);
  ok(perto(v.ateOFim, 2064) && perto(v.quitarHoje, 2064) && v.juros === 0 && v.total === 12, "vista: ateOFim 2064, juros 0", v);
}
{
  const p = projetar(comDivida({ parcela_valor: 100, parcelas_restantes: 5, proximo_vencimento: "2026-10-05" }), "2027-01", HOJE);
  const v = p.itens[0].vista;
  ok(v.atraso === false && v.etiqueta !== "atraso" && !!v.proxima && v.proxima.data >= "2027-01", "vista: atrasada deixa de ser atraso, próxima >= mês", v);
}
{
  const p = projetar(comDivida({ parcela_valor: 100, parcelas_restantes: 3, proximo_vencimento: "2027-02-05" }), "2027-01", HOJE);
  ok(p.itens[0].vista.proxima?.data === "2027-02", "vista: antes do início, próxima = primeiro mês", p.itens[0].vista.proxima);
}
{
  const k = (id: string, parcela: string, comp: string) =>
    ({ id, data: `${comp}-03`, descricao: "LOJA X", valor: -150, natureza: "despesa", conta_id: "cc", parcela, competencia: comp, data_compra: "2026-09-03", origem: { cartao_final: "1234" } }) as unknown as Movimentacao;
  const it = projetar(brutos({ movimentacoes: [k("k1", "8/10", "2026-11")] }), "2027-01", HOJE).itens.find((i) => i.divida.origem === "cartao");
  ok(!!it && it.vista.restantes === it.faltam && it.vista.proxima?.data === "2027-01", "vista cartão: restantes = faltam", it?.vista);
  const hojeV = juntarDividas(brutos({ movimentacoes: [k("k1", "8/10", "2026-11")] }), HOJE).find((x) => x.origem === "cartao");
  ok(!!it && !!hojeV && hojeV.pagas !== null && it.faltam !== null && it.vista.pagas === hojeV.pagas + (hojeV.restantes - it.faltam), "vista cartão: pagas = hoje + abatidas até o mês", [it?.vista.pagas, hojeV?.pagas, hojeV?.restantes, it?.faltam]);
}
{
  const p = projetar(comDivida({ parcela_valor: 100, parcelas_restantes: 4, proximo_vencimento: "2026-12-05" }), "2027-03", HOJE);
  ok(p.itens.length === 0, "vista: dívida que termina no mês não está em itens");
}
{
  const emp: Emprestimo[] = [{ id: "e1", pessoa: "João", direcao: "eu_devo", valor: 1000, data: "2026-06-01", pagamentos: [], situacao: "aberto", vencimento: "2026-09-01" } as Emprestimo];
  const it = projetar(brutos({ emprestimos: emp }), "2027-05", HOJE).itens[0];
  ok(it.vista.atraso === false && it.vista.etiqueta !== "atraso" && it.vista.ateOFim === it.divida.ateOFim, "vista pessoa: sem atraso, resto igual", it.vista);
}
{
  const emp = (venc: string): Emprestimo[] => [{ id: "e1", pessoa: "João", direcao: "eu_devo", valor: 1000, data: "2026-06-01", pagamentos: [], situacao: "aberto", vencimento: venc } as Emprestimo];
  const antes = projetar(brutos({ emprestimos: emp("2026-09-01") }), "2027-05", HOJE).itens[0];
  ok(antes.divida.proxima !== null && antes.vista.proxima === null, "vista pessoa: vencimento anterior ao mês some", [antes.divida.proxima, antes.vista.proxima]);
  const dentro = projetar(brutos({ emprestimos: emp("2027-05-10") }), "2027-05", HOJE).itens[0];
  ok(dentro.vista.proxima?.data === "2027-05-10", "vista pessoa: vencimento no mês fica", dentro.vista.proxima);
}
{
  const it = projetar(comDivida({ parcela_valor: 100, parcelas_restantes: 5, proximo_vencimento: "2026-12-05", taxa_mensal: 6.3 }), "2027-01", HOJE).itens[0];
  ok(it.vista.etiqueta === "juros_altos", "vista: juros_altos sobrevive à projeção", it.vista.etiqueta);
  const sj = projetar(comDivida({ parcela_valor: 100, parcelas_restantes: 5, proximo_vencimento: "2026-10-05", taxa_mensal: 0 }), "2027-01", HOJE).itens[0];
  ok(sj.vista.etiqueta === "sem_juros", "vista: sem_juros sobrevive (mesmo atrasada)", sj.vista.etiqueta);
}
// mesDaProjecao
ok(mesDaProjecao(2027, 3, HOJE) === "2027-03", "mesDaProjecao 2027-03");
ok(mesDaProjecao(2026, 11, HOJE) === null, "mesDaProjecao mês atual");
ok(mesDaProjecao(2026, 5, HOJE) === null, "mesDaProjecao passado");
ok(mesDaProjecao(2027, null, HOJE) === "2027-12", "mesDaProjecao ano futuro");
ok(mesDaProjecao(2026, null, HOJE) === "2026-12", "mesDaProjecao ano atual: dezembro ainda é futuro");
ok(mesDaProjecao(2025, null, HOJE) === null, "mesDaProjecao ano passado");

if (falhas) {
  console.error(`${falhas} falha(s)`);
  process.exit(1);
}
