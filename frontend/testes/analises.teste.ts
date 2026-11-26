import type { Brutos, CategoriaInfo, Divida, Fixa, Grupo, Holerite, Movimentacao, VisaoGeral } from "../src/api";
import {
  acimaDaMedia,
  faturaCartao,
  faturaDoMes,
  faturasDoBanco,
  melhorDiaDeCompra,
  fechamento,
  fraseAcima,
  fraseCartao,
  fraseFechamento,
  fraseFuturas,
  fraseNaoComecou,
  fraseOrigem,
  frasePatrimonio,
  fraseSobra,
  lerPeriodo,
  mesesDaBarra,
  mesesDoPeriodo,
  mesFinal,
  origens,
  patrimonioPorMes,
  proximasContas,
  reservaResumo,
  semOrigem,
  sobraDisponivel,
  sobraDoPeriodo,
  sobraMediaDisponivel,
  sobraPorMes,
  totaisDoMes,
} from "../src/analises";
import { definirOcultar } from "../src/formato";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}
const igual = (a: unknown, b: unknown, nome: string) => ok(JSON.stringify(a) === JSON.stringify(b), nome, { veio: a, esperado: b });

const HOJE = "2026-11-19";
const r = (v: number) => Math.round(v * 100) / 100;

// ---------- dados de exemplo: abril a novembro de 2026 ----------

const mov = (id: string, data: string, valor: number, extra: Partial<Movimentacao> = {}): Movimentacao =>
  ({ id, data, descricao: id.toUpperCase(), valor, natureza: valor < 0 ? "despesa" : "receita", conta_id: "c1", ...extra }) as Movimentacao;

const grupos: Grupo[] = [
  { id: "casa", nome: "Casa", tipo: "gasto", cor: "g1", detalhes: [], pede_pessoa: false, padrao: false },
  { id: "mercado", nome: "Mercado", tipo: "gasto", cor: "g2", detalhes: [], pede_pessoa: false, padrao: false },
  { id: "lazer", nome: "Lazer", tipo: "gasto", cor: "g3", detalhes: [], pede_pessoa: false, padrao: false },
  { id: "outros", nome: "Outros gastos", tipo: "gasto", cor: "g8", detalhes: [], pede_pessoa: false, padrao: true },
  { id: "g_sal", nome: "Salário", tipo: "entrada", cor: "g4", detalhes: [], pede_pessoa: false, padrao: false },
  { id: "extras", nome: "Extras", tipo: "entrada", cor: "g5", detalhes: [], pede_pessoa: false, padrao: false },
];

// Abril: só um gasto, sem receita no banco (a entrada vem do holerite).
const abril: Movimentacao[] = [mov("a1", "2026-04-10", -300, { categoria: "mercado" })];

// Maio a outubro: salário 5.000, casa 1.500, mercado 800, lazer 200 (maio e agosto com mercado grande).
const MERCADO: Record<string, number> = { "2026-05": 4000, "2026-08": 3900 };
const anteriores: Movimentacao[] = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].flatMap((m) => [
  mov(`sal${m}`, `${m}-05`, 5000, { categoria: "g_sal" }),
  mov(`alu${m}`, `${m}-06`, -1500, { categoria: "casa" }),
  mov(`mer${m}`, `${m}-12`, -(MERCADO[m] ?? 800), { categoria: "mercado" }),
  mov(`laz${m}`, `${m}-15`, -200, { categoria: "lazer" }),
]);

const novembro: Movimentacao[] = [
  mov("n1", "2026-11-05", 5000, { categoria: "g_sal" }),
  mov("n2", "2026-11-08", 50, { natureza: "estorno", categoria: "a_classificar" }),
  mov("n3", "2026-11-10", 250, { categoria: "extras" }),
  // Aluguel ligado à conta fixa (marcada paga no mês).
  mov("n4", "2026-11-06", -1500, { categoria: "casa", vinculo: { tipo: "fixa", id: "f_aluguel" } }),
  // Mercado dividido: 700 no mercado e 300 em lazer.
  mov("n5", "2026-11-12", -1000, { categoria: "mercado", partes: [{ valor: -700, categoria: "mercado" }, { valor: -300, categoria: "lazer" }] }),
  mov("n6", "2026-11-15", -100, { categoria: "lazer" }),
  // Assinatura marcada como recorrente fixa, que casa com a conta fixa Netflix pelo texto de busca.
  mov("n7", "2026-11-03", -50, { descricao: "NETFLIX.COM", categoria: "lazer", recorrencia: "fixa" }),
  mov("n8", "2026-11-10", -1000, { natureza: "transferencia_interna" }),
  mov("n9", "2026-11-10", -200, { natureza: "pagamento_divida", vinculo: { tipo: "divida", id: "d_loja" } }),
  mov("n10", "2026-11-16", -230, { categoria: "a_classificar" }),
  // Conta de luz achada no banco pelo texto de busca da conta fixa.
  mov("n11", "2026-11-17", -200, { descricao: "ENEL SP", categoria: "casa" }),
  // Cartão: parcela 1/5 na fatura de novembro (comprada em outubro), o resto na fatura de dezembro (aberta).
  mov("k0", "2026-10-04", -300, { conta_id: "cc", categoria: "outros", parcela: "1/5", data_compra: "2026-10-04", competencia: "2026-11" }),
  mov("k1", "2026-11-04", -300, { conta_id: "cc", categoria: "outros", parcela: "2/5", data_compra: "2026-10-04", competencia: "2026-12" }),
  mov("k2", "2026-11-11", -200, { conta_id: "cc", categoria: "mercado", competencia: "2026-12" }),
  mov("k3", "2026-11-13", -80, { conta_id: "cc", categoria: "a_classificar", competencia: "2026-12" }),
  mov("k4", "2026-11-14", -120, { conta_id: "cc", categoria: "lazer", competencia: "2026-12" }),
  mov("k5", "2026-11-02", -100, { conta_id: "cc", categoria: "lazer", parcela: "1/3", data_compra: "2026-11-02", competencia: "2026-12" }),
  mov("k6", "2026-11-15", 20, { conta_id: "cc", natureza: "estorno", categoria: "mercado", competencia: "2026-12" }),
];

const movimentacoes = [...abril, ...anteriores, ...novembro];

const fixa = (id: string, nome: string, valor: number, dia: number | null, extra: Partial<Fixa> = {}): Fixa => ({ id, nome, valor, dia, forma: "pix", ativa: true, pagos: [], ...extra });
const fixas: Fixa[] = [
  fixa("f_aluguel", "Aluguel", 1500, 6, { pagos: ["2026-11"] }),
  fixa("f_internet", "Internet", 100, 25, { busca: "VIVO" }),
  fixa("f_seguro", "Seguro do carro", 150, 28),
  // Dia já passou e não foi paga: atrasada.
  fixa("f_academia", "Academia", 90, 2),
  fixa("f_cancelada", "Revista", 999, 30, { ativa: false, cancelada_em: "2026-10-01" }),
  fixa("f_luz", "Luz", 200, 22, { busca: "ENEL" }),
  fixa("f_streaming", "Streaming", 30, null),
  fixa("f_netflix", "Netflix", 50, 3, { busca: "NETFLIX" }),
];

const div = (id: string, extra: Partial<Divida>): Divida => ({ id, credor: id, nome: id, situacao: "ativa", origem: { tipo: "informado" }, saldos: [], ...extra });
const dividas: Divida[] = [
  div("d_emp", { nome: "Empréstimo", tipo: "emprestimo", parcela_valor: 412.8, parcelas_total: 12, parcelas_restantes: 8, proximo_vencimento: "2026-11-25" }),
  div("d_loja", { nome: "Crediário", tipo: "acordo", parcela_valor: 200, parcelas_restantes: 3, proximo_vencimento: "2026-12-10" }),
  div("d_atrasada", { nome: "Acordo velho", tipo: "acordo", parcela_valor: 100, parcelas_restantes: 2, proximo_vencimento: "2026-11-10" }),
];

const hol = (competencia: string, extra: Partial<Holerite> = {}): Holerite => ({ id: `h${competencia}`, competencia, proventos: [], descontos: [], bruto: 6000, total_descontos: 1000, liquido: 5000, ...extra });
const holerites = [hol("2026-04", { liquido: 4900, liquido_competencia: 4800 }), hol("2026-09"), hol("2026-10"), hol("2026-11")];

const brutos = (extra: Partial<Brutos> = {}): Brutos =>
  ({
    holerites,
    movimentacoes,
    dividas,
    dividasTipos: [],
    dividasRecusados: [],
    documentos: [],
    descontosTemporarios: [],
    contas: [
      { id: "c1", tipo: "corrente", apelido: "Conta" },
      { id: "cc", tipo: "cartao", apelido: "Cartão" },
    ],
    emprestimos: [],
    categorias: grupos as unknown as CategoriaInfo[],
    metas: [],
    fixas,
    saldosContas: [],
    fixasIgnoradas: [],
    categoriasMigradas: true,
    ...extra,
  }) as Brutos;

// ---------- período ----------

igual(mesesDoPeriodo("2026-11", 3), ["2026-09", "2026-10", "2026-11"], "período de 3 meses");
igual(mesesDoPeriodo("2027-01", 6), ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"], "período de 6 meses vira o ano");

// ---------- totais ----------

// Entrou: 5.000 + 50 (estorno) + 250. Saiu: 1.500 + 1.000 + 100 + 50 + 230 + 200 + 300 (parcela do cartão na fatura de novembro).
igual(totaisDoMes(movimentacoes, "2026-11", undefined, holerites), { entrou: 5300, saiu: 3380, sobra: 1920, estimadoPeloHolerite: false }, "totais do mês: transferência e dívida paga ficam fora; com receita, o holerite não entra");
igual(totaisDoMes(movimentacoes, "2026-11", "2026-11-10"), { entrou: 5300, saiu: 1850, sobra: 3450, estimadoPeloHolerite: false }, "totais até um dia");
igual(totaisDoMes(movimentacoes, "2026-03", undefined, holerites), { entrou: 0, saiu: 0, sobra: 0, estimadoPeloHolerite: false }, "totais de mês vazio");
igual(totaisDoMes(movimentacoes, "2026-04", undefined, holerites), { entrou: 4800, saiu: 300, sobra: 4500, estimadoPeloHolerite: true }, "mês sem receita usa o líquido do holerite (como o servidor)");
igual(totaisDoMes(movimentacoes, "2026-04"), { entrou: 0, saiu: 300, sobra: -300, estimadoPeloHolerite: false }, "sem holerite, nada entra");

// ---------- 1. Vou fechar o mês no azul? ----------

const f = fechamento(brutos(), "2026-11", HOJE);
ok(f.atual, "mês atual");
igual(f.sobrouAteHoje, 1920, "sobrou até hoje");
igual(f.parcelas, 512.8, "parcelas ainda não pagas: a do empréstimo e a atrasada (a de dezembro fica fora)");
igual(
  f.listaParcelas,
  [
    { nome: "Acordo velho", dia: "2026-11-10", valor: 100 },
    { nome: "Empréstimo 5/12", dia: "2026-11-25", valor: 412.8 },
  ],
  "parcelas que faltam, uma por dívida, por vencimento",
);
igual(
  f.fixas,
  [
    { nome: "Academia", dia: "2026-11-02", valor: 90 },
    { nome: "Internet", dia: "2026-11-25", valor: 100 },
    { nome: "Seguro do carro", dia: "2026-11-28", valor: 150 },
    { nome: "Streaming", dia: "2026-11-30", valor: 30 },
  ],
  "contas fixas que faltam: com a atrasada; sem as pagas (ligada, marcada ou achada no banco) e a cancelada",
);
// Dia a dia: 1.000 + 100 + 230 = 1.330 em 19 dias = 70 por dia × 11 dias. Ficam fora: a parcela do
// cartão de outubro, o aluguel ligado, a Netflix (recorrente) e a luz (achada no banco).
igual(f.diaADia, 770, "dia a dia até o fim do mês");
igual(f.dividasPagas, 200, "dívidas já pagas no mês até hoje");
igual(f.fim, 67.2, "fim do mês: desconta a dívida paga no mês");
igual(
  f.passos,
  [
    { nome: "Sobrou até hoje", valor: 1920 },
    { nome: "Dívidas já pagas no mês", valor: -200 },
    { nome: "Parcelas que faltam", valor: -512.8 },
    { nome: "Contas fixas que faltam", valor: -370 },
    { nome: "Dia a dia até o fim do mês", valor: -770 },
  ],
  "passos da cascata",
);
igual(fraseFechamento(f), "Sim. Deve sobrar cerca de R$ 67 em 30/11.", "frase: vai sobrar");
ok(!f.fixas.some((x) => x.nome === "Netflix" || x.nome === "Luz"), "sem dupla contagem: a conta paga no banco não falta e o lançamento dela não está no dia a dia");

// Lançamento recorrente que não casa com nenhuma conta fixa: fora do dia a dia, nada muda nas fixas.
const fSemNetflix = fechamento(brutos({ fixas: fixas.filter((x) => x.id !== "f_netflix") }), "2026-11", HOJE);
igual([fSemNetflix.sobrouAteHoje, fSemNetflix.diaADia, fSemNetflix.fixas.length], [1920, 770, 4], "recorrente sem conta fixa: fora do dia a dia e das fixas");

const fLigada = fechamento(brutos({ movimentacoes: [...movimentacoes, mov("n12", "2026-11-18", -100, { categoria: "casa", vinculo: { tipo: "fixa", id: "f_internet" } })] }), "2026-11", HOJE);
igual(fLigada.fixas.map((x) => x.nome), ["Academia", "Seguro do carro", "Streaming"], "conta fixa ligada a um lançamento do mês não falta");

const fNeg = fechamento(brutos({ fixas: [...fixas, fixa("f_reforma", "Reforma", 1000, 29)] }), "2026-11", HOJE);
igual(fNeg.fim, -932.8, "fim do mês negativo");
igual(fraseFechamento(fNeg), "Não. Deve faltar cerca de R$ 933 em 30/11.", "frase: vai faltar");
const fZero = fechamento(brutos({ fixas: [...fixas, fixa("f_ajuste", "Ajuste", 67, 29)] }), "2026-11", HOJE);
igual(fraseFechamento(fZero), "Deve fechar no zero a zero em 30/11.", "frase: zero a zero");

const fOut = fechamento(brutos(), "2026-10", HOJE);
ok(!fOut.atual, "outubro não é o mês atual");
igual([fOut.sobrouAteHoje, fOut.parcelas, fOut.fixas, fOut.diaADia, fOut.fim, fOut.passos], [2500, 0, [], 0, 2500, []], "mês passado: só a sobra");
igual(fraseFechamento(fOut), "Fechou com sobra de R$ 2.500.", "frase: mês passado com sobra");
igual(fraseFechamento(fechamento(brutos(), "2026-05", HOJE)), "Fechou faltando R$ 700.", "frase: mês passado faltando");
igual(fraseFechamento(fechamento(brutos(), "2026-04", HOJE)), "Fechou com sobra de R$ 4.500.", "frase: mês passado com a entrada do holerite");
igual(fraseFechamento(fechamento(brutos(), "2026-03", HOJE)), "Nenhum lançamento em março.", "frase: mês passado vazio");

// Mês atual sem lançamentos: a previsão continua (0 − parcelas − fixas). A luz e a Netflix agora faltam.
const fVazio = fechamento(brutos({ movimentacoes: [] }), "2026-11", HOJE);
igual([fVazio.sobrouAteHoje, fVazio.parcelas, fVazio.diaADia, fVazio.fim], [0, 512.8, 0, -1132.8], "mês atual vazio: previsão sem NaN");
igual(fraseFechamento(fVazio), "Não. Deve faltar cerca de R$ 1.133 em 30/11.", "frase: mês atual vazio");

// ---------- 2. Para onde vai o cartão? ----------

const c = faturaCartao(brutos(), HOJE)!;
igual(c.mes, "2026-12", "fatura aberta: a mais recente");
igual(c.total, 780, "total da fatura: o estorno abate");
igual(
  c.linhas,
  [
    { nome: "Parcelas", cor: null, valor: 400 },
    { nome: "Mercado", cor: "g2", valor: 180 },
    { nome: "Lazer", cor: "g3", valor: 120 },
    { nome: "Sem categoria", cor: null, valor: 80 },
  ],
  "linhas da fatura: parcelas e sem categoria à parte, estorno no grupo dele",
);
igual(c.cartoes, [{ conta: "cc", nome: "Cartão", mes: "2026-12", total: 780 }], "um cartão");
// Compra de 5 parcelas (2/5 em dezembro) e de 3 parcelas (1/3 em dezembro).
igual(
  c.futuras,
  [
    { mes: "2027-01", valor: 400 },
    { mes: "2027-02", valor: 400 },
    { mes: "2027-03", valor: 300 },
    { mes: "2027-04", valor: 0 },
    { mes: "2027-05", valor: 0 },
    { mes: "2027-06", valor: 0 },
  ],
  "parcelas nas próximas 6 faturas",
);
igual(fraseCartao(c), "A fatura de dezembro está em R$ 780. Mercado é o que mais pesa, fora as parcelas.", "frase do cartão");
igual(fraseFuturas(c), "Até fevereiro, R$ 400 de cada fatura já estão ocupados por parcelas.", "frase das futuras: valor repete");
igual(
  fraseFuturas({ futuras: [{ mes: "2027-01", valor: 400.4 }, { mes: "2027-02", valor: 399.8 }, { mes: "2027-03", valor: 0 }] }),
  "Até fevereiro, R$ 400 de cada fatura já estão ocupados por parcelas.",
  "frase das futuras: repetição em reais inteiros",
);
igual(fraseFuturas({ futuras: [{ mes: "2027-01", valor: 400 }, { mes: "2027-02", valor: 300 }] }), "R$ 400 na próxima fatura.", "frase das futuras: não repete");
igual(fraseFuturas({ futuras: [{ mes: "2027-01", valor: 0 }] }), "Nenhuma parcela nas próximas faturas.", "frase das futuras: nenhuma");

// Dois cartões abertos (dezembro e novembro) e um fechado (só outubro).
const dois = faturaCartao(
  brutos({
    contas: [
      { id: "c1", tipo: "corrente" },
      { id: "cc", tipo: "cartao", apelido: "Cartão" },
      { id: "cc2", tipo: "cartao", apelido: "Nubank" },
      { id: "cc3", tipo: "cartao", instituicao: "Inter" },
    ],
    movimentacoes: [
      ...movimentacoes,
      mov("z0", "2026-09-20", -999, { conta_id: "cc2", categoria: "casa", competencia: "2026-10" }),
      mov("z1", "2026-11-01", -500, { conta_id: "cc2", categoria: "casa", competencia: "2026-11" }),
      mov("z2", "2026-09-20", -70, { conta_id: "cc3", categoria: "casa", competencia: "2026-10" }),
    ],
  }),
  HOJE,
)!;
igual(
  dois.cartoes,
  [
    { conta: "cc", nome: "Cartão", mes: "2026-12", total: 780 },
    { conta: "cc2", nome: "Nubank", mes: "2026-11", total: 500 },
  ],
  "cada cartão com a sua fatura aberta",
);
igual([dois.mes, dois.total, dois.linhas[0]], ["2026-12", 1280, { nome: "Casa", cor: "g1", valor: 500 }], "faturas abertas somadas");
igual(fraseCartao(dois), "As faturas abertas somam R$ 1.280. Casa é o que mais pesa, fora as parcelas.", "frase com dois cartões");

igual(faturaCartao(brutos(), "2027-01-10"), null, "sem fatura aberta");
igual(faturaCartao(brutos({ contas: [{ id: "c1", tipo: "corrente" }] }), HOJE), null, "sem cartão");
igual(fraseCartao(null), "Nenhuma fatura de cartão em aberto.", "frase sem fatura");
const soParcelas = faturaCartao(brutos({ movimentacoes: novembro.filter((m) => !["k2", "k3", "k4", "k6"].includes(m.id)) }), HOJE)!;
igual(fraseCartao(soParcelas), "A fatura de dezembro está em R$ 400.", "frase do cartão só com parcelas");

// ---------- 3. Está sobrando dinheiro? ----------

const seis = mesesDoPeriodo("2026-11", 6);
const s = sobraPorMes(brutos(), seis, HOJE);
igual(
  s,
  [
    { mes: "2026-06", sobra: 2500, parcial: false },
    { mes: "2026-07", sobra: 2500, parcial: false },
    { mes: "2026-08", sobra: -600, parcial: false },
    { mes: "2026-09", sobra: 2500, parcial: false },
    { mes: "2026-10", sobra: 2500, parcial: false },
    { mes: "2026-11", sobra: 1920, parcial: true },
  ],
  "sobra por mês pelos lançamentos, atual parcial",
);
igual(sobraPorMes(brutos(), ["2026-03", "2026-04"], HOJE), [{ mes: "2026-04", sobra: 4500, parcial: false }], "mês sem lançamentos fica fora; sem receita usa o holerite");
// Só os meses que acabaram: (2.500 + 2.500 − 600 + 2.500 + 2.500) / 5.
igual(fraseSobra(s), "Sobrou em 4 de 5 meses. Média de R$ 1.880 por mês (este mês ainda não acabou).", "frase da sobra com o mês atual");
igual(fraseSobra(s.slice(0, 2)), "Sobrou em 2 de 2 meses. Média de R$ 2.500 por mês.", "frase da sobra sem o mês atual");
igual(fraseSobra([{ mes: "2026-05", sobra: -700, parcial: false }]), "Sobrou em 0 de 1 mês. Em média, faltaram R$ 700 por mês.", "frase da sobra negativa");
igual(fraseSobra(s.slice(-1)), "Ainda não há meses suficientes para comparar.", "frase da sobra só com o mês atual");
igual(fraseSobra([]), "Ainda não há meses suficientes para comparar.", "frase da sobra vazia");

// ---------- 4. Onde gastei mais que o normal? ----------

const a = acimaDaMedia(movimentacoes, grupos, seis);
igual(
  a,
  [
    { grupo: "outros", nome: "Outros gastos", cor: "g8", mes: 300, media: 0 },
    { grupo: "lazer", nome: "Lazer", cor: "g3", mes: 450, media: 200 },
    { grupo: "casa", nome: "Casa", cor: "g1", mes: 1700, media: 1500 },
    { grupo: "mercado", nome: "Mercado", cor: "g2", mes: 700, media: 1420 },
  ],
  "acima da média: dividido conta em cada grupo, sem categoria fica fora",
);
igual(fraseAcima(a), "Outros gastos passou R$ 300 da sua média.", "frase acima da média");
igual(fraseAcima(a.filter((x) => x.grupo === "mercado")), "Nenhum grupo passou da média.", "frase: ninguém passou");
igual(acimaDaMedia(movimentacoes, grupos, ["2026-03", "2026-04"]), [], "sem meses anteriores com gasto");
igual(fraseAcima([]), "Ainda não há meses suficientes para comparar.", "frase acima sem meses");

// Antes de migrar: categorias antigas com os nomes de sempre e sem cor.
const antigas: CategoriaInfo[] = [
  { id: "mercado", nome: "Mercado", propria: false },
  { id: "lazer", nome: "Lazer", propria: false },
];
const movsAntigos = [mov("o1", "2026-10-02", -100, { categoria: "mercado" }), mov("o2", "2026-11-02", -250, { categoria: "mercado" }), mov("o3", "2026-11-03", -40, { categoria: "transporte" })];
igual(
  acimaDaMedia(movsAntigos, antigas, ["2026-10", "2026-11"]),
  [
    { grupo: "mercado", nome: "Mercado", cor: null, mes: 250, media: 100 },
    { grupo: "transporte", nome: "Transporte", cor: null, mes: 40, media: 0 },
  ],
  "acima da média com categorias antigas",
);

// ---------- 5. Meu patrimônio está crescendo? ----------

const visao = {
  ultimos_meses: [
    { competencia: "2026-05", fluxo: null, patrimonio: -3500, investimentos: null },
    { competencia: "2026-06", fluxo: null, patrimonio: -3000, investimentos: null },
    { competencia: "2026-07", fluxo: null, patrimonio: null, investimentos: null },
    { competencia: "2026-08", fluxo: null, patrimonio: -2500, investimentos: null },
    { competencia: "2026-09", fluxo: null, patrimonio: -2000, investimentos: null },
    { competencia: "2026-10", fluxo: null, patrimonio: -1500, investimentos: null },
    { competencia: "2026-11", fluxo: null, patrimonio: -1000, investimentos: null },
  ],
} as unknown as VisaoGeral;
const p = patrimonioPorMes(visao, seis);
igual(
  p,
  [
    { mes: "2026-06", valor: -3000 },
    { mes: "2026-08", valor: -2500 },
    { mes: "2026-09", valor: -2000 },
    { mes: "2026-10", valor: -1500 },
    { mes: "2026-11", valor: -1000 },
  ],
  "patrimônio por mês sem os meses sem dado",
);
igual(frasePatrimonio(p), "Sim. Subiu R$ 2.000 em 6 meses. Ainda negativo (-R$ 1.000), mas melhorando.", "frase do patrimônio negativo subindo");
igual(frasePatrimonio([{ mes: "2026-10", valor: 5000 }, { mes: "2026-11", valor: 4200 }]), "Não. Caiu R$ 800 em 2 meses.", "frase do patrimônio caindo");
igual(frasePatrimonio([{ mes: "2026-09", valor: 1000 }, { mes: "2026-11", valor: 1500 }]), "Sim. Subiu R$ 500 em 3 meses.", "frase do patrimônio positivo");
igual(frasePatrimonio([{ mes: "2026-10", valor: 1000 }, { mes: "2026-11", valor: 1000.4 }]), "Ficou praticamente igual em 2 meses.", "frase do patrimônio parado");
igual(frasePatrimonio(p.slice(0, 1)), "Ainda não há meses suficientes para comparar.", "frase do patrimônio com um mês");

// ---------- 6. De onde vem o meu dinheiro? ----------

const o = origens(movimentacoes, grupos, "2026-11");
igual(
  o,
  [
    { grupo: "g_sal", nome: "Salário", cor: "g4", valor: 5000 },
    { grupo: "extras", nome: "Extras", cor: "g5", valor: 250 },
  ],
  "origens do mês",
);
igual(semOrigem(movimentacoes, "2026-11"), 50, "entradas sem origem");
igual(fraseOrigem(o, "2026-11", 50), "O salário é 94% do que entrou em novembro.", "frase da origem com salário");
igual(fraseOrigem(o.slice(1), "2026-11"), "Extras é 100% do que entrou em novembro.", "frase da origem sem salário");
igual(fraseOrigem([], "2026-11", 50), "As entradas de novembro ainda não têm origem.", "frase: só sem origem");
igual(fraseOrigem([], "2026-03"), "Nenhuma entrada em março.", "frase: sem entradas");
igual(
  origens([mov("x1", "2026-11-05", 3000, { categoria: "salario" })], antigas, "2026-11"),
  [{ grupo: "salario", nome: "Salário", cor: null, valor: 3000 }],
  "origens com categorias antigas",
);

// ---------- Início: próximas contas e reserva ----------

igual(
  proximasContas(brutos(), HOJE),
  [
    { nome: "Academia", valor: 90, tipo: "fixa", data: "2026-11-02", atrasada: true },
    { nome: "Acordo velho", data: "2026-11-10", valor: 100, tipo: "divida", atrasada: true },
    { nome: "Empréstimo 5/12", data: "2026-11-25", valor: 412.8, tipo: "divida", atrasada: false },
  ],
  "próximas contas: atrasadas primeiro",
);
igual(
  proximasContas(brutos(), HOJE, 8)
    .slice(3)
    .map((x) => [x.nome, x.data, x.atrasada]),
  [
    ["Internet", "2026-11-25", false],
    ["Seguro do carro", "2026-11-28", false],
    ["Netflix", "2026-12-03", false],
    ["Aluguel", "2026-12-06", false],
    ["Crediário", "2026-12-10", false],
  ],
  "depois as próximas por data; as pagas neste mês voltam no seguinte",
);
igual(proximasContas(brutos(), "2026-11-25", 2).map((x) => [x.nome, x.atrasada]), [["Academia", true], ["Acordo velho", true]], "atrasadas antes das de hoje");
igual(
  proximasContas(brutos({ fixas: [fixa("f_internet", "Internet", 100, 25)], dividas: [] }), "2026-11-25"),
  [{ nome: "Internet", valor: 100, tipo: "fixa", data: "2026-11-25", atrasada: false }],
  "a conta de hoje não está atrasada",
);
igual(proximasContas(brutos({ fixas: [], dividas: [] }), HOJE), [], "sem próximas contas");

const meta = { id: "m1", nome: "Reserva", valor_alvo: 5000, saldo_reservado: 1000, usar_reserva: true };
// Sobra média de agosto a outubro: (−600 + 2.500 + 2.500) / 3 ≈ 1.466,67, para baixo em R$ 50 = 1.450; faltam 2.860 → 2 meses.
igual(reservaResumo(brutos({ metas: [meta] }), 2140, HOJE), { saldo: 2140, meta: 5000, pct: 43, frase: "Guardando R$ 1.450 por mês, chega lá em jan/2027." }, "reserva com meta");
igual(reservaResumo(brutos({ metas: [meta] }), null, HOJE)?.saldo, 1000, "reserva sem saldo do banco usa o anotado na meta");
igual(reservaResumo(brutos({ metas: [meta] }), 6000, HOJE), { saldo: 6000, meta: 5000, pct: 120, frase: "Meta alcançada." }, "reserva acima da meta");
igual(reservaResumo(brutos({ metas: [meta], movimentacoes: [] }), 2140, HOJE)?.frase, null, "sem sobra média, sem frase");
igual(reservaResumo(brutos(), 2140, HOJE), { saldo: 2140, meta: null, pct: null, frase: null }, "reserva sem meta");
igual(reservaResumo(brutos(), null, HOJE), null, "sem reserva");

// ---------- correções da revisão final ----------

// 1. Pagar uma parcela ligada à dívida não muda a previsão.
{
  const antes = fechamento(brutos(), "2026-11", HOJE);
  const pago = mov("pg", "2026-11-18", -412.8, { natureza: "pagamento_divida", vinculo: { tipo: "divida", id: "d_emp" } });
  const dividasDepois = dividas.map((d) => (d.id === "d_emp" ? { ...d, parcelas_restantes: 7, proximo_vencimento: "2026-12-25" } : d));
  const depois = fechamento(brutos({ movimentacoes: [...movimentacoes, pago], dividas: dividasDepois }), "2026-11", HOJE);
  igual([depois.dividasPagas, depois.parcelas, depois.fim], [612.8, 100, antes.fim], "parcela paga e ligada no mês: previsão igual antes e depois");
  // Paga sem ligar: a parcela continua faltando (conservador, nunca melhora a previsão).
  const semVinculo = fechamento(brutos({ movimentacoes: [...movimentacoes, { ...pago, vinculo: null }] }), "2026-11", HOJE);
  ok(semVinculo.fim <= antes.fim, "paga sem vínculo: conservador", semVinculo.fim);
  // Pagamento de dívida depois de hoje não entra.
  const futuro = fechamento(brutos({ movimentacoes: [...movimentacoes, { ...pago, data: "2026-11-25" }] }), "2026-11", HOJE);
  igual(futuro.dividasPagas, 200, "dívida paga depois de hoje fica fora");
}

// 2. Sobra disponível: o que sobrou menos as dívidas pagas no mês.
igual(sobraDisponivel(movimentacoes, "2026-11", holerites), 1720, "sobra disponível de novembro: 1.920 − 200");
igual(sobraDisponivel(movimentacoes, "2026-04", holerites), 4500, "sobra disponível com o holerite");
igual(sobraMediaDisponivel(movimentacoes, "2026-11", holerites), 1450, "média dos 3 meses completos, para baixo em R$ 50");
{
  const comDivida = [...movimentacoes, mov("pd10", "2026-10-20", -500, { natureza: "pagamento_divida" })];
  // (−600 + 2.500 + 2.000) / 3 = 1.300.
  igual(sobraMediaDisponivel(comDivida, "2026-11", holerites), 1300, "média desconta as dívidas pagas");
  igual(reservaResumo(brutos({ metas: [meta], movimentacoes: comDivida }), 2140, HOJE)?.frase, "Guardando R$ 1.300 por mês, chega lá em fev/2027.", "reserva usa a sobra disponível");
  igual(sobraMediaDisponivel([mov("x", "2026-10-02", -900)], "2026-11"), 0, "média negativa vira 0");
  igual(sobraMediaDisponivel([], "2026-11"), 0, "sem meses, 0");
}

// 3. Entrada estimada pelo holerite aparece como "Salário (pelo holerite)".
igual(origens(movimentacoes, grupos, "2026-04", holerites), [{ grupo: "holerite", nome: "Salário (pelo holerite)", cor: null, valor: 4800 }], "origens de mês sem receita: salário pelo holerite");
igual(origens(movimentacoes, grupos, "2026-11", holerites), o, "com receita, sem a linha do holerite");
igual(fraseOrigem(origens(movimentacoes, grupos, "2026-04", holerites), "2026-04"), "O salário é 100% do que entrou em abril.", "frase da origem com o salário pelo holerite");

// 4. Mês futuro na barra do topo.
{
  const dez = fechamento(brutos(), "2026-12", HOJE);
  igual([dez.atual, dez.futuro, dez.jaLancado, dez.passos], [false, true, 800, []], "dezembro ainda não começou: gastos já lançados, sem cascata");
  igual(fraseFechamento(dez), "Dezembro ainda não começou. Já há R$ 800 de compras no cartão para esse mês.", "frase do mês futuro com compras");
  igual(fraseFechamento(fechamento(brutos(), "2027-02", HOJE)), "Fevereiro ainda não começou.", "frase do mês futuro sem compras");
  ok(!fechamento(brutos(), "2026-11", HOJE).futuro && !fechamento(brutos(), "2026-10", HOJE).futuro, "mês atual e passado não são futuros");
  igual(sobraPorMes(brutos(), mesesDoPeriodo("2026-12", 3), HOJE).map((x) => x.mes), ["2026-10", "2026-11"], "sobra por mês sem o mês futuro");
  igual(fraseNaoComecou(brutos(), ["2026-12"], HOJE), "Dezembro ainda não começou. Já há R$ 800 de compras no cartão para esse mês.", "Início: mês futuro, a frase da pergunta 1");
  igual(fraseNaoComecou(brutos(), mesesDaBarra(2027, null), HOJE), "2027 ainda não começou.", "Início: ano futuro");
  igual(fraseNaoComecou(brutos(), ["2026-11"], HOJE), null, "Início: mês atual já começou");
  igual(acimaDaMedia(movimentacoes, grupos, mesesDoPeriodo("2026-12", 6), HOJE), acimaDaMedia(movimentacoes, grupos, mesesDoPeriodo("2026-11", 5)), "acima da média sem o mês futuro");
}

// 5. Pagamento atrasado ligado ao mês anterior não paga a conta deste mês.
{
  const atrasado = mov("ia", "2026-11-03", -100, { categoria: "casa", vinculo: { tipo: "fixa", id: "f_internet", mes: "2026-10" } });
  const fx = fechamento(brutos({ movimentacoes: [...movimentacoes, atrasado] }), "2026-11", HOJE);
  ok(fx.fixas.some((x) => x.nome === "Internet"), "internet de outubro paga em novembro: a de novembro ainda falta", fx.fixas);
  igual(proximasContas(brutos({ movimentacoes: [...movimentacoes, atrasado] }), HOJE, 8).find((x) => x.nome === "Internet")?.data, "2026-11-25", "próximas contas: a internet de novembro continua");
}

// 6. Dia a dia sem contas fixas marcadas à mão nem gastos que se repetem todo mês.
{
  const pagoAMao = fixas.map((x) => (x.id === "f_seguro" ? { ...x, pagos: ["2026-11"] } : x));
  const seguro = mov("seg", "2026-11-14", -151, { descricao: "PORTO SEGURO", categoria: "casa" });
  const fm = fechamento(brutos({ fixas: pagoAMao, movimentacoes: [...movimentacoes, seguro] }), "2026-11", HOJE);
  igual([fm.diaADia, fm.fixas.some((x) => x.nome === "Seguro do carro")], [770, false], "conta fixa marcada paga: o lançamento de mesmo valor (±1%) sai do dia a dia");
  const dois = fechamento(brutos({ fixas: pagoAMao, movimentacoes: [...movimentacoes, seguro, { ...seguro, id: "seg2" }] }), "2026-11", HOJE);
  igual(dois.diaADia, r(((1330 + 151) / 19) * 11), "só um lançamento por conta fixa marcada");
  const longe = fechamento(brutos({ fixas: pagoAMao, movimentacoes: [...movimentacoes, { ...seguro, valor: -160 }] }), "2026-11", HOJE);
  igual(longe.diaADia, r(((1330 + 160) / 19) * 11), "valor diferente (mais de 1%) continua no dia a dia");

  const aluguel = (id: string, data: string, valor: number, descricao = "ALUGUEL IMOBILIARIA") => mov(id, data, valor, { descricao, categoria: "casa" });
  const historico = [aluguel("al7", "2026-07-08", -900), aluguel("al8", "2026-08-08", -880, "Aluguel  Imobiliária"), aluguel("al10", "2026-10-08", -920)];
  const fr = fechamento(brutos({ movimentacoes: [...movimentacoes, ...historico, aluguel("al11", "2026-11-08", -900)] }), "2026-11", HOJE);
  igual(fr.diaADia, 770, "gasto que se repete em 3 dos 4 meses anteriores (±15%) sai do dia a dia");
  const caro = fechamento(brutos({ movimentacoes: [...movimentacoes, ...historico, aluguel("al11", "2026-11-08", -1200)] }), "2026-11", HOJE);
  igual(caro.diaADia, r(((1330 + 1200) / 19) * 11), "valor fora dos 15%: conta no dia a dia");
  const poucos = fechamento(brutos({ movimentacoes: [...movimentacoes, ...historico.slice(0, 2), aluguel("al11", "2026-11-08", -900)] }), "2026-11", HOJE);
  igual(poucos.diaADia, r(((1330 + 900) / 19) * 11), "em só 2 meses: conta no dia a dia");
  // Supermercado com várias compras por mês: não é recorrente mensal, continua no dia a dia.
  const assai = ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"].flatMap((m) => [1, 2, 3, 4].map((i) => mov(`as${m}${i}`, `${m}-${String(i * 4).padStart(2, "0")}`, -200, { descricao: "ASSAI", categoria: "mercado" })));
  const fa = fechamento(brutos({ movimentacoes: [...movimentacoes, ...assai, ...historico, aluguel("al11", "2026-11-08", -900)] }), "2026-11", HOJE);
  igual(fa.diaADia, r(((1330 + 800) / 19) * 11), "ASSAI 4 vezes por mês fica no dia a dia; ALUGUEL 1 vez por mês sai");
  const duasNoMes = fechamento(brutos({ movimentacoes: [...movimentacoes, ...historico, aluguel("al11", "2026-11-08", -900), aluguel("al11b", "2026-11-09", -900)] }), "2026-11", HOJE);
  igual(duasNoMes.diaADia, r(((1330 + 1800) / 19) * 11), "duas vezes no mês atual: conta no dia a dia");
}

// 10. Cartão com total zero ou negativo não tem fatura aberta.
{
  const so = faturaCartao(
    brutos({
      contas: [{ id: "c1", tipo: "corrente" }, { id: "cc", tipo: "cartao", apelido: "Cartão" }, { id: "cc2", tipo: "cartao", apelido: "Nubank" }],
      movimentacoes: [...movimentacoes, mov("e1", "2026-11-12", 60, { conta_id: "cc2", natureza: "estorno", categoria: "casa", competencia: "2026-12" })],
    }),
    HOJE,
  )!;
  igual([so.cartoes.map((k) => k.conta), so.total, so.linhas.some((l) => l.nome === "Casa")], [["cc"], 780, false], "cartão só com estorno fica fora");
}

// 9 e 11. Mês final, período e "Sobrou até agora" cortado em hoje.
igual([mesFinal(2026, null, HOJE), mesFinal(2025, null, HOJE), mesFinal(2026, 3, HOJE)], ["2026-11", "2025-12", "2026-03"], "mês final das análises");
igual(lerPeriodo(), 6, "período padrão sem armazenamento");
igual(mesesDaBarra(2026, 11), ["2026-11"], "meses da barra: um mês");
igual(mesesDaBarra(2026, null).length, 12, "meses da barra: o ano");
{
  const depoisDeHoje = [...movimentacoes, mov("dh", "2026-11-25", -100, { categoria: "lazer" })];
  igual(sobraDoPeriodo(depoisDeHoje, ["2026-11"], HOJE, holerites), { entrou: 5300, saiu: 3380, sobra: 1920, estimadoPeloHolerite: false }, "mês atual cortado em hoje");
  igual(sobraDoPeriodo(depoisDeHoje, ["2026-04", "2026-10"], HOJE, holerites), { entrou: 9800, saiu: 2800, sobra: 7000, estimadoPeloHolerite: true }, "meses somados, com o holerite");
}

// ---------- valores escondidos ----------

definirOcultar(true);
igual(fraseFechamento(f), "Sim. Deve sobrar cerca de R$ ••••• em 30/11.", "frase com valores escondidos");
definirOcultar(false);

// ---------- Início: fatura do mês (só a competência pedida, não o limite usado) ----------

{
  const cc = (id: string, data: string, valor: number, comp: string, extra: Partial<Movimentacao> = {}) =>
    mov(id, data, valor, { conta_id: "cc", competencia: comp, ...extra });
  const b = brutos({
    contas: [
      { id: "c1", tipo: "corrente", apelido: "Conta" },
      { id: "cc", tipo: "cartao", apelido: "Cartão" },
      { id: "cc2", tipo: "cartao", apelido: "Nubank" },
    ] as Brutos["contas"],
    movimentacoes: [
      cc("f1", "2026-11-02", -200, "2026-11"),
      cc("f2", "2026-11-05", -50, "2026-11", { status: "pendente" }),
      cc("f3", "2026-11-06", 30, "2026-11", { natureza: "estorno" }),
      // Parcela de fatura futura e pagamento da fatura: fora.
      cc("f4", "2026-11-07", -100, "2026-12", { parcela: "02/05" }),
      cc("f5", "2026-11-08", 500, "2026-11", { natureza: "transferencia" }),
      mov("f6", "2026-11-09", -70, { conta_id: "cc2", competencia: "2026-11" }),
      // Pendente que o banco deixou na fatura anterior (já paga): entra na atual. Confirmada antiga: fora.
      cc("f8", "2026-10-30", -40, "2026-10", { status: "pendente", parcela: "02/03" }),
      cc("f9", "2026-10-20", -300, "2026-10"),
      // Conta corrente: não é cartão.
      mov("f7", "2026-11-09", -999, { competencia: "2026-11" }),
    ],
  });
  const f = faturaDoMes(b, "2026-11")!;
  igual(f.total, 330, "fatura do mês: gastos menos estornos, competência do mês e pendentes antigas");
  igual(f.cartoes, [{ conta: "cc", nome: "Cartão", total: 260 }, { conta: "cc2", nome: "Nubank", total: 70 }], "fatura do mês por cartão");
  igual(f.pendentes, 90, "fatura do mês: compras pendentes");
  igual(faturaDoMes(b, "2026-08"), null, "sem lançamentos no mês: sem fatura");
}

// ---------- Início: faturas fechadas pelo banco ----------

{
  const faturas = [
    { fechamento: "2026-10-30", vencimento: "2026-11-07", total: 2095.91, minimo: 209.59 },
    { fechamento: "2026-09-30", vencimento: "2026-10-07", total: 1890.73, minimo: 221.1 },
  ];
  const movs = [
    mov("pg", "2026-11-06", 2095.91, { conta_id: "cc", competencia: "2026-11", natureza: "transferencia_interna" }),
    mov("x1", "2026-10-10", -2000, { conta_id: "cc", competencia: "2026-10" }),
    mov("x2", "2026-10-30", -379.24, { conta_id: "cc", competencia: "2026-10", status: "pendente" }),
  ];
  const r = faturasDoBanco(faturas, movs, "cc", "2026-11-23")!;
  igual(r.proximoFechamento, "2026-11-30", "próximo fechamento: mesmo dia, um mês depois");
  igual(r.ultima, { vencimento: "2026-11-07", total: 2095.91, paga: true, lancamentos: 2379.24 }, "última fatura fechada, paga, com a soma dos lançamentos");
  const semPagar = faturasDoBanco(faturas, movs.slice(1), "cc", "2026-11-03")!;
  igual(semPagar.ultima.paga, false, "fatura fechada sem pagamento");
  // Fechou em 31/01: fevereiro não tem 31.
  igual(faturasDoBanco([{ fechamento: "2027-01-31", vencimento: "2027-02-07", total: 10, minimo: null }], [], "cc", "2027-02-01")!.proximoFechamento, "2027-02-28", "fechamento no dia 31 vira o último dia do mês");
  igual(faturasDoBanco([], movs, "cc", "2026-11-23"), null, "sem faturas do banco");
  igual(faturasDoBanco([{ fechamento: "2026-10-27", vencimento: "2026-11-10", total: -175.69, minimo: 0 }], [], "cc", "2026-11-23")!.ultima.paga, true, "crédito a favor: nada a pagar");
}

// ---------- Melhor dia de compra ----------

igual(
  melhorDiaDeCompra("2026-11-30", "2026-12-07", "2026-11-23"),
  { dia: "2026-12-01", venceAtual: "2026-12-07", vence: "2027-01-07", agora: false },
  "melhor dia: o seguinte ao fechamento, compra vence no mês depois",
);
igual(
  // Em 01/11 o banco ainda informa o vencimento da fatura fechada (07/11): o que comprar agora vence em 07/12.
  melhorDiaDeCompra("2026-11-30", "2026-11-07", "2026-11-01"),
  { dia: "2026-12-01", venceAtual: "2026-12-07", vence: "2027-01-07", agora: true },
  "logo depois do fechamento anterior (até 10 dias): é a melhor época agora",
);
igual(melhorDiaDeCompra("2026-11-30", "2026-12-07", "2026-11-11").agora, false, "11 dias depois do fechamento anterior já não é a melhor época");
igual(melhorDiaDeCompra(null, "2026-12-07", "2026-11-23"), null, "sem fechamento, sem melhor dia");
igual(melhorDiaDeCompra("2027-01-31", "2027-02-07", "2027-01-20")?.dia, "2027-02-01", "fechamento no último dia do mês");

if (falhas) {
  console.error(`${falhas} teste(s) falharam`);
  process.exit(1);
}
