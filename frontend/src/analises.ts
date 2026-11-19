import type { Brutos, CategoriaInfo, Fixa, Grupo, Holerite, Movimentacao, VisaoGeral } from "./api";
import { juntarDividas, parcelasCartao } from "./dividas";
import { situacao, pagamentoNoBanco } from "./fixas";
import { addMes, capitalizar, hojeISO, MASCARA, MESES, MESES_CURTOS, nomeCategoria, reaisTexto, valoresOcultos } from "./formato";
import { ehEntrada, ehGasto, partesDe } from "./grupos";
import { normalizar } from "./movimentos";

/**
 * As contas da tela Análises e do Início: cada pergunta tem um cálculo e uma frase-resposta.
 * Tudo puro: `hoje` (AAAA-MM-DD) e o mês escolhido (AAAA-MM) vêm de fora.
 * Totais: gasto = despesa (cada parte no seu grupo), entrada = receita + estorno; transferências,
 * aportes, dívidas pagas e empréstimos não contam. Competência = `competencia ?? data[0:7]`.
 */

const r2 = (v: number) => Math.round(v * 100) / 100;
const compDe = (m: { data: string; competencia?: string | null }) => m.competencia ?? m.data.slice(0, 7);
const SEM_CATEGORIA = (c: string) => !c || c === "a_classificar";
const POUCOS_MESES = "Ainda não há meses suficientes para comparar.";

/** Reais inteiros para as frases ("R$ 1.235"), escondidos no modo "esconder valores". */
const rs = (v: number) => (valoresOcultos() ? MASCARA : reaisTexto(Math.round(v) || 0).replace(/,00$/, ""));
const nomeMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1];
const diasNoMes = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
/** Data AAAA-MM-DD do dia `dia` no mês (31 em novembro vira 30). */
const diaNoMes = (mes: string, dia: number) => `${mes}-${String(Math.min(dia, diasNoMes(mes))).padStart(2, "0")}`;
const difMes = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Nome e cor de um grupo. Depois de migrar (itens com `tipo`), os do grupo; antes, o nome da
 * categoria antiga (`nomeCategoria`) e cor nenhuma.
 */
function infoGrupos(grupos: (Grupo | CategoriaInfo)[]) {
  const migrado = grupos.some((g) => "tipo" in g);
  const porId = new Map(grupos.map((g) => [g.id, g]));
  return {
    tipo: (id: string) => (migrado ? (porId.get(id) as Grupo | undefined)?.tipo : undefined),
    info: (id: string) => {
      const g = porId.get(id) as Grupo | undefined;
      return migrado ? { nome: g?.nome ?? nomeCategoria(id), cor: g?.cor ?? null } : { nome: nomeCategoria(id), cor: null };
    },
  };
}

// ---------- período e totais ----------

export type Periodo = 3 | 6;

const CHAVE_PERIODO = "tf-analises";

/** Período guardado das Análises (padrão 6 meses; sem armazenamento local, 6). */
export function lerPeriodo(): Periodo {
  try {
    return localStorage.getItem(CHAVE_PERIODO) === "3" ? 3 : 6;
  } catch {
    return 6;
  }
}
export function gravarPeriodo(p: Periodo) {
  try {
    localStorage.setItem(CHAVE_PERIODO, String(p));
  } catch {
    /* navegador sem armazenamento local */
  }
}

/** Mês final das análises: o escolhido na barra do topo; com o ano inteiro, o mês de hoje (ano atual) ou dezembro. */
export function mesFinal(ano: number, mes: number | null, hoje: string): string {
  if (mes !== null) return `${ano}-${String(mes).padStart(2, "0")}`;
  return String(ano) === hoje.slice(0, 4) ? hoje.slice(0, 7) : `${ano}-12`;
}

/** Os meses do período da barra do topo: o mês escolhido ou os doze do ano. */
export function mesesDaBarra(ano: number, mes: number | null): string[] {
  if (mes) return [`${ano}-${String(mes).padStart(2, "0")}`];
  return Array.from({ length: 12 }, (_, i) => addMes(`${ano}-01`, i));
}

/** Os `n` meses que terminam em `fim` (inclusive), do mais antigo para o mais recente. */
export function mesesDoPeriodo(fim: string, n: Periodo): string[] {
  return Array.from({ length: n }, (_, i) => addMes(fim, i - (n - 1)));
}

/**
 * Entrou, saiu e sobrou no mês; com `ateDia` (AAAA-MM-DD), só os lançamentos até esse dia.
 * Como no servidor: mês com lançamentos e sem nenhuma receita usa o líquido do holerite da
 * competência como entrada (os estornos somam por cima).
 */
export interface Totais {
  entrou: number;
  saiu: number;
  sobra: number;
  /** A entrada veio do líquido do holerite (o salário ainda não apareceu na conta). */
  estimadoPeloHolerite: boolean;
}

/** Líquido do holerite usado como entrada do mês (mês com lançamentos e sem nenhuma receita); 0 quando não se aplica. */
function salarioPeloHolerite(movs: Movimentacao[], mes: string, holerites: Holerite[]): number {
  const doHolerite = holerites.filter((h) => h.competencia === mes);
  if (!doHolerite.length) return 0;
  const doMes = movs.filter((m) => compDe(m) === mes);
  if (!doMes.length || doMes.some((m) => m.natureza === "receita")) return 0;
  return r2(doHolerite.reduce((s, h) => s + (h.liquido_competencia ?? h.liquido), 0));
}

export function totaisDoMes(movs: Movimentacao[], mes: string, ateDia?: string, holerites: Holerite[] = []): Totais {
  let entrou = 0;
  let saiu = 0;
  let estornos = 0;
  for (const m of movs) {
    if (compDe(m) !== mes) continue;
    if (ateDia && m.data.slice(0, 10) > ateDia) continue;
    if (m.natureza === "estorno") estornos += m.valor;
    else if (ehEntrada(m)) entrou += m.valor;
    else if (ehGasto(m)) saiu -= m.valor;
  }
  const holerite = salarioPeloHolerite(movs, mes, holerites);
  if (holerite > 0) entrou = holerite;
  entrou += estornos;
  return { entrou: r2(entrou), saiu: r2(saiu), sobra: r2(entrou - saiu), estimadoPeloHolerite: holerite > 0 };
}

/** Totais somados dos meses da barra do topo; o mês de hoje só até hoje (como a pergunta 1). Meses futuros não têm nada até hoje. */
export function sobraDoPeriodo(movs: Movimentacao[], meses: string[], hoje: string, holerites: Holerite[] = []): Totais {
  const mesHoje = hoje.slice(0, 7);
  const t = { entrou: 0, saiu: 0, estimadoPeloHolerite: false };
  for (const m of meses) {
    const x = totaisDoMes(movs, m, m === mesHoje ? hoje : undefined, holerites);
    t.entrou += x.entrou;
    t.saiu += x.saiu;
    t.estimadoPeloHolerite ||= x.estimadoPeloHolerite;
  }
  return { entrou: r2(t.entrou), saiu: r2(t.saiu), sobra: r2(t.entrou - t.saiu), estimadoPeloHolerite: t.estimadoPeloHolerite };
}

/** Pagamentos de dívida do mês (positivo); com `ateDia`, só os feitos até esse dia. */
function dividasPagasNoMes(movs: Movimentacao[], mes: string, ateDia?: string): number {
  return r2(movs.filter((m) => m.natureza === "pagamento_divida" && compDe(m) === mes && (!ateDia || m.data.slice(0, 10) <= ateDia)).reduce((s, m) => s - m.valor, 0));
}

/** O que dá para guardar do mês: o que sobrou (`totaisDoMes`) menos as dívidas pagas no mês. */
export function sobraDisponivel(movs: Movimentacao[], mes: string, holerites: Holerite[] = []): number {
  return r2(totaisDoMes(movs, mes, undefined, holerites).sobra - dividasPagasNoMes(movs, mes));
}

/**
 * Sugestão do que dá para separar por mês (reserva e Objetivos): a média de `sobraDisponivel` nos
 * últimos 3 meses completos com lançamentos, para baixo em R$ 50; nunca negativa.
 */
export function sobraMediaDisponivel(movs: Movimentacao[], mesAtual: string, holerites: Holerite[] = []): number {
  const comLancamento = new Set(movs.map(compDe));
  const meses = [1, 2, 3].map((i) => addMes(mesAtual, -i)).filter((m) => comLancamento.has(m));
  if (!meses.length) return 0;
  const media = meses.reduce((s, m) => s + sobraDisponivel(movs, m, holerites), 0) / meses.length;
  return Math.max(0, Math.floor(media / 50) * 50);
}

/** Mês que um lançamento ligado a uma conta fixa pagou: o guardado ao ligar ou, sem ele, a competência. */
const mesDaFixa = (m: Movimentacao) => m.vinculo?.mes || compDe(m);
const ligadoAFixa = (m: Movimentacao, f: Fixa, mes: string) => m.vinculo?.tipo === "fixa" && m.vinculo.id === f.id && mesDaFixa(m) === mes;

/** A conta fixa já está paga no mês: marcada, achada no banco (fixas.ts) ou com um lançamento ligado a ela. */
function fixaPaga(f: Fixa, movs: Movimentacao[], mes: string): boolean {
  return situacao(f, movs, mes, 1).tipo === "paga" || movs.some((m) => ligadoAFixa(m, f, mes));
}

// ---------- 1. Vou fechar o mês no azul? ----------

export interface Fechamento {
  mes: string;
  /** O mês escolhido é o de hoje (há previsão); senão, só o que sobrou. */
  atual: boolean;
  /** O mês escolhido ainda não começou. */
  futuro: boolean;
  /** Mês futuro: gastos já lançados com essa competência (compras no cartão). */
  jaLancado: number;
  /** Nenhum lançamento no mês (só usado na frase de mês passado). */
  vazio: boolean;
  sobrouAteHoje: number;
  /** Pagamentos de dívida do mês até hoje (o "Sobrou" não os desconta). */
  dividasPagas: number;
  parcelas: number;
  /** As parcelas de `parcelas`, uma por dívida (`dia`: vencimento AAAA-MM-DD, pode ser antes de hoje). */
  listaParcelas: { nome: string; dia: string; valor: number }[];
  /** `dia`: data prevista (AAAA-MM-DD); sem dia cadastrado, o último dia do mês. Inclui as atrasadas. */
  fixas: { nome: string; dia: string; valor: number }[];
  diaADia: number;
  fim: number;
  /** Barras da cascata, sem a última ("Fim do mês" = `fim`). Vazio em mês passado. */
  passos: { nome: string; valor: number }[];
}

/** Ids dos lançamentos que pagam uma conta fixa ativa no mês pelo casamento de fixas.ts (texto de busca). */
function idsDeFixas(b: Brutos, mes: string): Set<string> {
  const ids = new Set<string>();
  for (const f of b.fixas) {
    if (!f.ativa) continue;
    const m = pagamentoNoBanco(f, b.movimentacoes, mes);
    if (m) ids.add(m.id);
  }
  return ids;
}

/**
 * Ids dos gastos do mês que não entram no dia a dia além dos já ligados ou achados no banco:
 * (a) para cada conta fixa ativa marcada paga à mão no mês (sem lançamento ligado nem achado no
 * banco), um lançamento do mês com o mesmo valor (±1%); (b) gastos que se repetem todo mês mesmo
 * sem conta fixa: a mesma descrição (normalizada) exatamente uma vez por mês em pelo menos 3 dos 4
 * meses anteriores, com valor parecido (±15%), e uma vez só no mês. Compras várias vezes por mês
 * (supermercado) continuam no dia a dia.
 */
function idsForaDoDiaADia(b: Brutos, mes: string, candidatos: Movimentacao[]): Set<string> {
  const ids = new Set<string>();
  for (const f of b.fixas) {
    if (!f.ativa || !f.pagos?.includes(mes) || pagamentoNoBanco(f, b.movimentacoes, mes) || b.movimentacoes.some((m) => ligadoAFixa(m, f, mes))) continue;
    const m = candidatos.find((x) => !ids.has(x.id) && Math.abs(-x.valor - f.valor) <= f.valor * 0.01 + 0.004);
    if (m) ids.add(m.id);
  }
  const anteriores = [1, 2, 3, 4].map((i) => addMes(mes, -i));
  const porDescricao = new Map<string, Movimentacao[]>();
  for (const m of b.movimentacoes) {
    if (!ehGasto(m) || (compDe(m) !== mes && !anteriores.includes(compDe(m)))) continue;
    const k = normalizar(m.descricao ?? "");
    if (k) porDescricao.set(k, [...(porDescricao.get(k) ?? []), m]);
  }
  for (const m of candidatos) {
    const iguais = porDescricao.get(normalizar(m.descricao ?? "")) ?? [];
    const noMes = (c: string) => iguais.filter((x) => compDe(x) === c);
    if (noMes(mes).length !== 1) continue;
    const meses = anteriores.filter((c) => {
      const l = noMes(c);
      return l.length === 1 && Math.abs(l[0].valor - m.valor) <= Math.abs(m.valor) * 0.15;
    });
    if (meses.length >= 3) ids.add(m.id);
  }
  return ids;
}

/**
 * Previsão do fim do mês: sobrou até hoje − dívidas já pagas no mês − parcelas de dívidas cadastradas ainda não pagas
 * (próxima parcela neste mês ou antes) − contas fixas ativas ainda não pagas no mês (atrasadas
 * também) − dia a dia (média por dia dos gastos do mês até hoje que não são de contas fixas,
 * parcelas nem gastos que se repetem todo mês × dias que faltam). Nenhuma entrada prevista. Em mês
 * passado, só o que sobrou; em mês futuro, só os gastos já lançados nele.
 */
export function fechamento(b: Brutos, mes: string, hoje: string): Fechamento {
  const atual = mes === hoje.slice(0, 7);
  const futuro = mes > hoje.slice(0, 7);
  const vazio = !b.movimentacoes.some((m) => compDe(m) === mes && (ehGasto(m) || ehEntrada(m)) && (!atual || m.data.slice(0, 10) <= hoje));
  const semPrevisao = { mes, atual, futuro, vazio, jaLancado: 0, dividasPagas: 0, parcelas: 0, listaParcelas: [], fixas: [], diaADia: 0, passos: [] };
  if (futuro) {
    const jaLancado = r2(b.movimentacoes.filter((m) => compDe(m) === mes && ehGasto(m)).reduce((s, m) => s - m.valor, 0));
    return { ...semPrevisao, jaLancado, sobrouAteHoje: 0, fim: 0 };
  }
  if (!atual) {
    const { sobra } = totaisDoMes(b.movimentacoes, mes, undefined, b.holerites);
    return { ...semPrevisao, sobrouAteHoje: sobra, fim: sobra };
  }
  const sobrouAteHoje = totaisDoMes(b.movimentacoes, mes, hoje, b.holerites).sobra;
  const dividasPagas = dividasPagasNoMes(b.movimentacoes, mes, hoje);
  const listaParcelas = juntarDividas(b, hoje)
    .filter((d) => d.origem === "cadastrada" && d.proxima && d.proxima.data.slice(0, 7) <= mes)
    .map((d) => ({ nome: d.total !== null && d.pagas !== null ? `${d.nome} ${d.pagas + 1}/${d.total}` : d.nome, dia: d.proxima!.data, valor: d.proxima!.valor }))
    .sort((x, y) => x.dia.localeCompare(y.dia) || x.nome.localeCompare(y.nome, "pt-BR"));
  const parcelas = r2(listaParcelas.reduce((s, p) => s + p.valor, 0));
  const fixas = b.fixas
    .filter((f) => f.ativa && !fixaPaga(f, b.movimentacoes, mes))
    .map((f) => ({ nome: f.nome, dia: diaNoMes(mes, f.dia || 31), valor: f.valor }))
    .sort((x, y) => x.dia.localeCompare(y.dia) || x.nome.localeCompare(y.nome, "pt-BR"));
  const totalFixas = r2(fixas.reduce((s, f) => s + f.valor, 0));
  const diaHoje = Number(hoje.slice(8, 10));
  const deFixas = idsDeFixas(b, mes);
  const candidatos = b.movimentacoes.filter(
    (m) =>
      compDe(m) === mes &&
      ehGasto(m) &&
      m.data.slice(0, 10) >= `${mes}-01` &&
      m.data.slice(0, 10) <= hoje &&
      !m.parcela &&
      m.vinculo?.tipo !== "fixa" &&
      m.recorrencia !== "fixa" &&
      !deFixas.has(m.id),
  );
  const fora = idsForaDoDiaADia(b, mes, candidatos);
  const variaveis = candidatos.filter((m) => !fora.has(m.id)).reduce((s, m) => s - m.valor, 0);
  const diaADia = r2((variaveis / diaHoje) * (diasNoMes(mes) - diaHoje));
  const fim = r2(sobrouAteHoje - dividasPagas - parcelas - totalFixas - diaADia);
  return {
    mes,
    atual,
    futuro,
    vazio,
    jaLancado: 0,
    sobrouAteHoje,
    dividasPagas,
    parcelas,
    listaParcelas,
    fixas,
    diaADia,
    fim,
    passos: [
      { nome: "Sobrou até hoje", valor: sobrouAteHoje },
      { nome: "Dívidas já pagas no mês", valor: -dividasPagas },
      { nome: "Parcelas que faltam", valor: -parcelas },
      { nome: "Contas fixas que faltam", valor: -totalFixas },
      { nome: "Dia a dia até o fim do mês", valor: -diaADia },
    ],
  };
}

export function fraseFechamento(r: Fechamento): string {
  if (r.futuro) {
    const inicio = `${capitalizar(nomeMes(r.mes))} ainda não começou.`;
    return r.jaLancado >= 0.5 ? `${inicio} Já há ${rs(r.jaLancado)} de compras no cartão para esse mês.` : inicio;
  }
  if (!r.atual) {
    if (r.vazio) return `Nenhum lançamento em ${nomeMes(r.mes)}.`;
    return r.fim >= 0 ? `Fechou com sobra de ${rs(r.fim)}.` : `Fechou faltando ${rs(-r.fim)}.`;
  }
  const dia = `${String(diasNoMes(r.mes)).padStart(2, "0")}/${r.mes.slice(5, 7)}`;
  if (Math.abs(r.fim) < 1) return `Deve fechar no zero a zero em ${dia}.`;
  return r.fim > 0 ? `Sim. Deve sobrar cerca de ${rs(r.fim)} em ${dia}.` : `Não. Deve faltar cerca de ${rs(-r.fim)} em ${dia}.`;
}

/** Início: frase do período da barra do topo que ainda não começou (a da pergunta 1 num mês só); null quando já começou. */
export function fraseNaoComecou(b: Brutos, meses: string[], hoje: string): string | null {
  if (!meses.length || meses[0] <= hoje.slice(0, 7)) return null;
  return meses.length === 1 ? fraseFechamento(fechamento(b, meses[0], hoje)) : `${meses[0].slice(0, 4)} ainda não começou.`;
}

// ---------- 2. Para onde vai o cartão? ----------

export interface FaturaCartao {
  /** Competência da fatura aberta mais recente (AAAA-MM). */
  mes: string;
  /** Soma das faturas abertas (gastos menos estornos). */
  total: number;
  /** Do maior para o menor; "Parcelas" e "Sem categoria" vêm com cor nula. */
  linhas: { nome: string; cor: string | null; valor: number }[];
  /** Cada cartão com fatura aberta, na ordem das contas. */
  cartoes: { conta: string; nome: string; mes: string; total: number }[];
  /** Parcelas já marcadas nas 6 faturas seguintes a `mes`, de todos os cartões. */
  futuras: { mes: string; valor: number }[];
}

/**
 * Faturas em aberto dos cartões (contas do tipo cartão): de cada cartão, a competência mais
 * recente com lançamentos, se for do mês atual ou depois. Os gastos vão por grupo (cada parte no
 * seu), as compras parceladas juntas em "Parcelas" e o que não tem grupo em "Sem categoria"; os
 * estornos abatem o grupo deles (ou "Sem categoria").
 */
export function faturaCartao(b: Brutos, hoje: string): FaturaCartao | null {
  const mesHoje = hoje.slice(0, 7);
  const { info } = infoGrupos(b.categoriasMigradas ? b.categorias : []);
  const soma = new Map<string, number>();
  const somar = (k: string, v: number) => soma.set(k, (soma.get(k) ?? 0) + v);
  const cartoes: FaturaCartao["cartoes"] = [];
  for (const c of b.contas.filter((x) => x.tipo === "cartao")) {
    const lancs = b.movimentacoes.filter((m) => m.conta_id === c.id && (ehGasto(m) || m.natureza === "estorno"));
    const mes = lancs.reduce((x, m) => (compDe(m) > x ? compDe(m) : x), "");
    if (!mes || mes < mesHoje) continue;
    const doMes = lancs.filter((m) => compDe(m) === mes);
    const total = doMes.reduce((s, m) => s - m.valor, 0);
    // Só estornos (ou crédito maior que os gastos): nada a pagar, não é fatura aberta.
    if (total <= 0.004) continue;
    for (const m of doMes) {
      if (m.parcela && ehGasto(m)) somar("\0parcelas", -m.valor);
      else for (const p of partesDe(m)) somar(SEM_CATEGORIA(p.categoria) ? "\0sem" : p.categoria, -p.valor);
    }
    cartoes.push({ conta: c.id, nome: c.apelido || c.instituicao || "Cartão", mes, total: r2(total) });
  }
  if (!cartoes.length) return null;
  const mes = cartoes.reduce((x, c) => (c.mes > x ? c.mes : x), "");
  const linhas = [...soma.entries()]
    .map(([k, v]) => ({ ...(k === "\0parcelas" ? { nome: "Parcelas", cor: null } : k === "\0sem" ? { nome: "Sem categoria", cor: null } : info(k)), valor: r2(v) }))
    .filter((l) => l.valor > 0.004)
    .sort((x, y) => y.valor - x.valor);
  // Em `parcelasCartao`, os meses são os de vencimento (competência + 1).
  const pc = parcelasCartao(b, hoje);
  const futuras = [1, 2, 3, 4, 5, 6].map((i) => {
    const m = addMes(mes, i);
    const venc = addMes(m, 1);
    return { mes: m, valor: r2(pc.reduce((s, p) => s + (p.meses.includes(venc) ? p.valor : 0), 0)) };
  });
  return { mes, total: r2(cartoes.reduce((s, c) => s + c.total, 0)), linhas, cartoes, futuras };
}

export function fraseCartao(r: FaturaCartao | null): string {
  if (!r) return "Nenhuma fatura de cartão em aberto.";
  const maior = r.linhas.find((l) => l.nome !== "Parcelas" && l.nome !== "Sem categoria");
  const inicio = r.cartoes.length > 1 ? `As faturas abertas somam ${rs(r.total)}.` : `A fatura de ${nomeMes(r.mes)} está em ${rs(r.total)}.`;
  return `${inicio}${maior ? ` ${maior.nome} é o que mais pesa, fora as parcelas.` : ""}`;
}

/** Legenda de "Já marcado nas próximas faturas" (repetição comparada em reais inteiros). */
export function fraseFuturas(r: Pick<FaturaCartao, "futuras">): string {
  const f = r.futuras;
  const v0 = Math.round(f[0]?.valor ?? 0);
  if (v0 <= 0) return "Nenhuma parcela nas próximas faturas.";
  let j = 0;
  while (j + 1 < f.length && Math.round(f[j + 1].valor) === v0) j++;
  return j > 0 ? `Até ${nomeMes(f[j].mes)}, ${rs(v0)} de cada fatura já estão ocupados por parcelas.` : `${rs(v0)} na próxima fatura.`;
}

// ---------- 3. Está sobrando dinheiro? ----------

/** Entrou − saiu (`totaisDoMes`) em cada mês do período com lançamentos, sem os meses futuros; `parcial` = o mês de hoje. */
export function sobraPorMes(b: Brutos, meses: string[], hoje: string = hojeISO()): { mes: string; sobra: number; parcial: boolean }[] {
  const mesHoje = hoje.slice(0, 7);
  const comLancamento = new Set(b.movimentacoes.map(compDe));
  return meses
    .filter((m) => comLancamento.has(m) && m <= mesHoje)
    .map((mes) => ({ mes, sobra: totaisDoMes(b.movimentacoes, mes, undefined, b.holerites).sobra, parcial: mes === mesHoje }));
}

/** N, M e a média contam só os meses que já acabaram; o mês atual ganha um aviso no fim. */
export function fraseSobra(l: { mes: string; sobra: number; parcial: boolean }[]): string {
  const completos = l.filter((x) => !x.parcial);
  if (!completos.length) return POUCOS_MESES;
  const n = completos.filter((x) => x.sobra > 0.004).length;
  const media = completos.reduce((s, x) => s + x.sobra, 0) / completos.length;
  const aviso = l.some((x) => x.parcial) ? " (este mês ainda não acabou)" : "";
  const inicio = `Sobrou em ${n} de ${completos.length} ${completos.length === 1 ? "mês" : "meses"}.`;
  return media >= 0 ? `${inicio} Média de ${rs(media)} por mês${aviso}.` : `${inicio} Em média, faltaram ${rs(-media)} por mês${aviso}.`;
}

// ---------- 4. Onde gastei mais que o normal? ----------

export interface AcimaDaMedia {
  grupo: string;
  nome: string;
  cor: string | null;
  mes: number;
  media: number;
}

/**
 * Gasto de cada grupo no último mês de `meses` contra a média dos meses anteriores do período
 * que tiveram gasto. Do maior excesso para o menor. Sem mês anterior com gasto: lista vazia.
 * Com `hoje`, os meses depois do de hoje ficam fora (o avaliado passa a ser o mês de hoje).
 */
export function acimaDaMedia(movs: Movimentacao[], grupos: Grupo[] | CategoriaInfo[], todos: string[], hoje?: string): AcimaDaMedia[] {
  const meses = hoje ? todos.filter((m) => m <= hoje.slice(0, 7)) : todos;
  const avaliado = meses[meses.length - 1];
  const g = infoGrupos(grupos);
  const porMes = new Map<string, Map<string, number>>(meses.map((m) => [m, new Map()]));
  for (const m of movs) {
    const t = ehGasto(m) ? porMes.get(compDe(m)) : undefined;
    if (!t) continue;
    for (const p of partesDe(m)) {
      if (SEM_CATEGORIA(p.categoria) || g.tipo(p.categoria) === "entrada") continue;
      t.set(p.categoria, (t.get(p.categoria) ?? 0) - p.valor);
    }
  }
  const anteriores = meses.slice(0, -1).filter((m) => [...porMes.get(m)!.values()].some((v) => v > 0.004));
  if (!avaliado || !anteriores.length) return [];
  const ids = new Set(anteriores.concat(avaliado).flatMap((m) => [...porMes.get(m)!.keys()]));
  return [...ids]
    .map((id) => ({
      grupo: id,
      ...g.info(id),
      mes: r2(porMes.get(avaliado)!.get(id) ?? 0),
      media: r2(anteriores.reduce((s, m) => s + (porMes.get(m)!.get(id) ?? 0), 0) / anteriores.length),
    }))
    .filter((x) => x.mes > 0.004 || x.media > 0.004)
    .sort((x, y) => y.mes - y.media - (x.mes - x.media) || x.nome.localeCompare(y.nome, "pt-BR"));
}

export function fraseAcima(l: AcimaDaMedia[]): string {
  if (!l.length) return POUCOS_MESES;
  const maior = l[0];
  return maior.mes - maior.media >= 0.5 ? `${maior.nome} passou ${rs(maior.mes - maior.media)} da sua média.` : "Nenhum grupo passou da média.";
}

// ---------- 5. Meu patrimônio está crescendo? ----------

/** Patrimônio no fim de cada mês do período; meses sem dado ficam fora. */
export function patrimonioPorMes(v: VisaoGeral, meses: string[]): { mes: string; valor: number }[] {
  return meses.flatMap((mes) => {
    const p = v.ultimos_meses.find((x) => x.competencia === mes)?.patrimonio;
    return p == null ? [] : [{ mes, valor: p }];
  });
}

/** "em N meses" conta do primeiro ao último mês com dado, inclusive (como o período escolhido). */
export function frasePatrimonio(l: { mes: string; valor: number }[]): string {
  if (l.length < 2) return POUCOS_MESES;
  const primeiro = l[0];
  const ultimo = l[l.length - 1];
  const dif = ultimo.valor - primeiro.valor;
  const n = difMes(primeiro.mes, ultimo.mes) + 1;
  if (Math.abs(dif) < 1) return `Ficou praticamente igual em ${n} meses.`;
  const base = dif > 0 ? `Sim. Subiu ${rs(dif)} em ${n} meses.` : `Não. Caiu ${rs(-dif)} em ${n} meses.`;
  return ultimo.valor < 0 && dif > 0 ? `${base} Ainda negativo (${rs(ultimo.valor)}), mas melhorando.` : base;
}

// ---------- 6. De onde vem o meu dinheiro? ----------

export interface Origem {
  grupo: string;
  nome: string;
  cor: string | null;
  valor: number;
}

/** Grupo da linha "Salário (pelo holerite)" em `origens`. */
export const GRUPO_HOLERITE = "holerite";

/**
 * Entradas do mês por grupo (cada parte no seu), da maior para a menor; as sem origem ficam em
 * `semOrigem`. Quando a entrada do mês vem do holerite (`totaisDoMes`), uma linha
 * "Salário (pelo holerite)" com o líquido.
 */
export function origens(movs: Movimentacao[], grupos: Grupo[] | CategoriaInfo[], mes: string, holerites: Holerite[] = []): Origem[] {
  const g = infoGrupos(grupos);
  const holerite = salarioPeloHolerite(movs, mes, holerites);
  const t = new Map<string, number>();
  for (const m of movs) {
    if (!ehEntrada(m) || compDe(m) !== mes) continue;
    for (const p of partesDe(m)) if (!SEM_CATEGORIA(p.categoria)) t.set(p.categoria, (t.get(p.categoria) ?? 0) + p.valor);
  }
  const linhas = [...t.entries()].map(([id, v]) => ({ grupo: id, ...g.info(id), valor: r2(v) }));
  if (holerite > 0) linhas.push({ grupo: GRUPO_HOLERITE, nome: "Salário (pelo holerite)", cor: null, valor: holerite });
  return linhas.filter((o) => o.valor > 0.004).sort((x, y) => y.valor - x.valor);
}

/** Quanto entrou no mês sem origem escolhida. */
export function semOrigem(movs: Movimentacao[], mes: string): number {
  let s = 0;
  for (const m of movs) {
    if (!ehEntrada(m) || compDe(m) !== mes) continue;
    for (const p of partesDe(m)) if (SEM_CATEGORIA(p.categoria)) s += p.valor;
  }
  return r2(s);
}

/** A parte do salário no que entrou (com as entradas sem origem no total); sem salário, a do maior grupo. */
export function fraseOrigem(l: Origem[], mes: string, semOrigemValor = 0): string {
  const total = l.reduce((s, o) => s + o.valor, 0) + semOrigemValor;
  if (total <= 0.004) return `Nenhuma entrada em ${nomeMes(mes)}.`;
  if (!l.length) return `As entradas de ${nomeMes(mes)} ainda não têm origem.`;
  const salario = l.find((o) => o.grupo === "salario" || o.grupo === GRUPO_HOLERITE || semAcento(o.nome) === "salario");
  const alvo = salario ?? l[0];
  const pct = Math.round((alvo.valor / total) * 100);
  return salario ? `O salário é ${pct}% do que entrou em ${nomeMes(mes)}.` : `${alvo.nome} é ${pct}% do que entrou em ${nomeMes(mes)}.`;
}

// ---------- Início ----------

export interface ProximaConta {
  nome: string;
  data: string;
  valor: number;
  tipo: "fixa" | "divida";
  /** Já venceu e não foi paga. */
  atrasada: boolean;
}

/**
 * As próximas contas: primeiro as atrasadas (conta fixa ativa deste mês com o dia já passado e
 * não paga; parcela de dívida cadastrada com vencimento antes de hoje), depois as que vencem de
 * hoje em diante (a conta fixa deste mês, se ainda não venceu e não está paga, ou a do mês
 * seguinte; a próxima parcela de cada dívida). Contas fixas sem dia ficam fora.
 */
export function proximasContas(b: Brutos, hoje: string, n = 3): ProximaConta[] {
  const mes = hoje.slice(0, 7);
  const seguinte = addMes(mes, 1);
  const fixas = b.fixas
    .filter((f) => f.ativa && f.dia)
    .flatMap((f): ProximaConta[] => {
      const neste = diaNoMes(mes, f.dia!);
      const base = { nome: f.nome, valor: f.valor, tipo: "fixa" as const };
      if (!fixaPaga(f, b.movimentacoes, mes)) return [{ ...base, data: neste, atrasada: neste < hoje }];
      return fixaPaga(f, b.movimentacoes, seguinte) ? [] : [{ ...base, data: diaNoMes(seguinte, f.dia!), atrasada: false }];
    });
  const dividas = juntarDividas(b, hoje)
    .filter((d) => d.origem === "cadastrada" && d.proxima)
    .map((d) => ({
      nome: d.total !== null && d.pagas !== null ? `${d.nome} ${d.pagas + 1}/${d.total}` : d.nome,
      data: d.proxima!.data,
      valor: d.proxima!.valor,
      tipo: "divida" as const,
      atrasada: d.proxima!.data < hoje,
    }));
  return [...fixas, ...dividas]
    .sort((x, y) => Number(y.atrasada) - Number(x.atrasada) || x.data.localeCompare(y.data) || x.nome.localeCompare(y.nome, "pt-BR"))
    .slice(0, n);
}

/**
 * Reserva de emergência: saldo (o das contas de reserva; sem ele, o anotado na meta que acompanha
 * a reserva), a meta com `usar_reserva`, quanto já tem (%) e, com a sobra média disponível
 * (`sobraMediaDisponivel`, a mesma de Objetivos) positiva, quando
 * chega lá. null sem saldo e sem meta.
 */
export function reservaResumo(b: Brutos, saldo: number | null, hoje: string): { saldo: number; meta: number | null; pct: number | null; frase: string | null } | null {
  const meta = b.metas.find((m) => m.usar_reserva) ?? null;
  if (saldo === null && !meta) return null;
  const valor = saldo ?? meta!.saldo_reservado;
  if (!meta || !(meta.valor_alvo > 0)) return { saldo: valor, meta: null, pct: null, frase: null };
  const pct = Math.round((valor / meta.valor_alvo) * 100);
  const falta = meta.valor_alvo - valor;
  if (falta <= 0.004) return { saldo: valor, meta: meta.valor_alvo, pct, frase: "Meta alcançada." };
  const mesHoje = hoje.slice(0, 7);
  const porMes = sobraMediaDisponivel(b.movimentacoes, mesHoje, b.holerites);
  if (porMes < 1) return { saldo: valor, meta: meta.valor_alvo, pct, frase: null };
  const chega = addMes(mesHoje, Math.ceil(falta / porMes));
  return { saldo: valor, meta: meta.valor_alvo, pct, frase: `Guardando ${rs(porMes)} por mês, chega lá em ${MESES_CURTOS[Number(chega.slice(5, 7)) - 1]}/${chega.slice(0, 4)}.` };
}
