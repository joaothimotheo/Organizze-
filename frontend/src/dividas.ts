import type { Brutos, Divida, Movimentacao } from "./api";
import { aberto, falta, porPessoa, vencido } from "./emprestimos";
import { taxaImplicita } from "./extra";
import { addMes, hojeISO } from "./formato";
import type { Parcelada } from "./plano";

/**
 * Dívidas numa lista só: as cadastradas por você, as compras parceladas no cartão (lidas das
 * faturas) e o que você deve a pessoas. Daqui saem os números da tela de Dívidas: quanto falta,
 * juros, peso das parcelas no salário, quando fica livre, pagamentos achados no banco,
 * simulação de adiantamento e ordem para quitar. Tudo puro: `hoje` (AAAA-MM-DD) vem de fora.
 */

const r2 = (v: number) => Math.round(v * 100) / 100;
/** Diferença abaixo de meio centavo conta como zero. */
const CENTAVO = 0.005;
/** Folga das comparações entre frações e valores calculados (erro de arredondamento). */
const FOLGA = 1e-9;
/** A partir disso (fração ao mês) a dívida ganha a etiqueta "Juros altos". */
export const JUROS_ALTOS = 0.03;
/** Dias antes e depois de um vencimento em que um lançamento pode ser a parcela. */
const JANELA_DIAS = 10;

/** Meses de `a` até `b` ("2026-09" → "2026-11" = 2). */
const difMes = (a: string, b: string) => {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

/** Último item da lista (sem `Array.at`, que falta em navegadores antigos de celular). */
const ultimo = <T>(l: T[]): T | undefined => l[l.length - 1];

// ---------- parcelamentos (o que a tela já usava) ----------

export interface Parcelamento {
  chave: string;
  /** Lançamentos do cartão desta compra (todas as parcelas vistas), para dar nome a todos de uma vez. */
  ids: string[];
  /** Descrição como veio do banco, quando você deu outro nome. */
  noBanco: string | null;
  doCartao: boolean;
  origem: string;
  descricao: string;
  categoria: string | null;
  atual: number | null;
  total: number | null;
  valor: number;
  restantes: number;
  saldo: number;
  meses: string[];
}

/**
 * Parcelas a vencer de cada cartão, a partir de todas as faturas (não só da última, que pode
 * estar aberta e ainda sem todas as parcelas do mês).
 *
 * Cada compra é reconhecida pela data da compra (ou, sem ela, pelo mês da 1ª parcela), pelo total
 * de parcelas e pelo valor em reais inteiros (a última parcela pode diferir em centavos). Vale a
 * parcela confirmada mais adiantada; as pendentes da Pluggy só contam se não houver confirmada,
 * porque chegam com a numeração do mês seguinte. A compra é avançada até a fatura mais recente
 * do cartão; se essa fatura ainda está aberta (mês atual ou futuro), a parcela dela ainda conta.
 * As datas em `meses` são os meses de vencimento (o mês seguinte ao ciclo).
 */
export function parcelasCartao(b: Brutos, hoje: string = hojeISO()): Parcelamento[] {
  const mv = b.movimentacoes.filter((x) => x.parcela && x.natureza === "despesa" && x.competencia && -x.valor > 0.004);
  const ultimoDoCartao: Record<string, string> = {};
  mv.forEach((x) => {
    const c = x.conta_id ?? "?";
    if (!ultimoDoCartao[c] || x.competencia! > ultimoDoCartao[c]) ultimoDoCartao[c] = x.competencia!;
  });
  const mesAtual = hoje.slice(0, 7);

  type Ocorrencia = { x: (typeof mv)[number]; k: number; t: number; pendente: boolean };
  const compras = new Map<string, Ocorrencia[]>();
  for (const x of mv) {
    const [k, t] = String(x.parcela).split("/").map(Number);
    if (!k || !t || k > t) continue;
    const inicio = x.data_compra ? `d${x.data_compra}` : `m${addMes(x.competencia!, -(k - 1))}`;
    const chave = [x.conta_id ?? "?", inicio, t, Math.round(-x.valor)].join("|");
    const l = compras.get(chave) ?? [];
    l.push({ x, k, t, pendente: x.status === "pendente" });
    compras.set(chave, l);
  }

  const out: Parcelamento[] = [];
  for (const ocorrencias of compras.values()) {
    const confirmadas = ocorrencias.filter((o) => !o.pendente);
    const base = confirmadas.length ? confirmadas : ocorrencias;
    const conta = base[0].x.conta_id ?? "?";
    const ref = ultimoDoCartao[conta];
    const aberta = ref >= mesAtual;
    // Parcela que cai na fatura de referência (a mais recente do cartão).
    const pos = (o: Ocorrencia) => o.k + difMes(o.x.competencia!, ref);
    const o = base.reduce((m, y) => (pos(y) > pos(m) ? y : m));
    const atual = pos(o);
    const r = o.t - atual + (aberta ? 1 : 0);
    if (r <= 0) continue;
    const v = -o.x.valor;
    const primeiro = aberta ? 1 : 2;
    // O nome que você deu vale para a compra toda; parcela nova que chegar sem nome herda o das outras.
    const nome = [...ocorrencias].sort((a, c) => c.x.data.localeCompare(a.x.data)).find((y) => y.x.nome?.trim())?.x.nome?.trim();
    out.push({
      chave: o.x.id,
      ids: ocorrencias.map((y) => y.x.id),
      noBanco: nome ? o.x.descricao : null,
      doCartao: true,
      origem: `Cartão ${o.x.origem?.cartao_final ?? ""}`.trim(),
      descricao: nome || o.x.descricao,
      categoria: o.x.categoria ?? null,
      atual: Math.max(1, Math.min(atual, o.t)),
      total: o.t,
      valor: v,
      restantes: r,
      saldo: r * v,
      meses: Array.from({ length: r }, (_, i) => addMes(ref, primeiro + i)),
    });
  }
  return out.sort((a, b) => b.saldo - a.saldo);
}

export const informada = (d: Divida) => d.origem?.tipo === "informado";

export function parcelasInformadas(b: Brutos, hoje: string = hojeISO()): Parcelamento[] {
  return b.dividas
    .filter((d) => informada(d) && d.situacao !== "quitada" && (d.parcelas_restantes ?? 0) > 0 && (d.parcela_valor ?? 0) > 0)
    .map((d) => {
      const r = d.parcelas_restantes!;
      const v = d.parcela_valor!;
      const t = d.parcelas_total && d.parcelas_total >= r ? d.parcelas_total : null;
      const inicio = d.proximo_vencimento ? d.proximo_vencimento.slice(0, 7) : addMes(hoje.slice(0, 7), 1);
      return {
        chave: d.id,
        ids: [],
        noBanco: null,
        doCartao: false,
        origem: "Informada por você",
        descricao: d.nome ?? d.credor,
        categoria: null,
        // A próxima parcela a pagar: com 16 de 19 faltando, é a 4ª.
        atual: t ? t - r + 1 : null,
        total: t,
        valor: v,
        restantes: r,
        saldo: r * v,
        meses: Array.from({ length: r }, (_, i) => addMes(inicio, i)),
      };
    });
}

/** Só as compras parceladas no cartão, no formato da simulação do plano. */
export function parcelasDoCartao(b: Brutos): Parcelada[] {
  return parcelasCartao(b).filter((p) => p.restantes > 0).map((p) => ({ nome: p.descricao, valor: p.valor, meses: p.meses }));
}

/** Parcelamentos ainda correndo (cartão e informados), no formato da simulação do plano. */
export function parceladasAtivas(b: Brutos): Parcelada[] {
  return [...parcelasCartao(b), ...parcelasInformadas(b)].filter((p) => p.restantes > 0).map((p) => ({ nome: p.descricao, valor: p.valor, meses: p.meses }));
}

/** O saldo mais recente informado da dívida. */
export function ultimoSaldo(d: Divida) {
  return [...(d.saldos ?? [])].sort((a, b) => a.data.localeCompare(b.data)).pop() ?? null;
}

/** O saldo mais recente informado por você ou vindo de um documento (não o estimado de um lançamento ligado). */
export function ultimoSaldoInformado(d: Divida) {
  return [...(d.saldos ?? [])].filter((s) => s.origem?.tipo !== "lancamento").sort((a, b) => a.data.localeCompare(b.data)).pop() ?? null;
}

/**
 * O lançamento dessa data vem depois do último saldo informado? O que foi pago até esse dia já
 * está descontado do saldo e não baixa parcela. Sem saldo informado, vale a data do cadastro.
 */
export function depoisDoSaldoInformado(d: Divida, data: string): boolean {
  const base = ultimoSaldoInformado(d)?.data ?? d.informado_em?.slice(0, 10) ?? null;
  return base === null || data > base;
}

// ---------- tipos ----------

export const TIPOS_PADRAO: { id: "cartao" | "emprestimo" | "pessoas" | "outras"; nome: string }[] = [
  { id: "cartao", nome: "Cartão parcelado" },
  { id: "emprestimo", nome: "Empréstimos" },
  { id: "pessoas", nome: "Com pessoas" },
  { id: "outras", nome: "Outras dívidas" },
];

/** Em que tipo (aba) a dívida cadastrada aparece. Tipo apagado ou desconhecido → "outras". */
export function tipoDaDivida(d: Divida, criados: { id: string }[]): string {
  const t = d.tipo ?? "";
  if (t === "emprestimo" || t === "financiamento") return "emprestimo";
  if (t === "cartao" || t === "cartao_de_credito") return "cartao";
  if (criados.some((c) => c.id === t)) return t;
  return "outras";
}

// ---------- datas ----------

/** Dias de um mês ("2026-02" → 28). */
const diasNoMes = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
};

/** Soma meses a uma data mantendo o dia (31/01 + 1 mês → 28/02). */
export function somarMesesData(iso: string, n: number): string {
  const mes = addMes(iso.slice(0, 7), n);
  const dia = Math.min(Number(iso.slice(8, 10)) || 1, diasNoMes(mes));
  return `${mes}-${String(dia).padStart(2, "0")}`;
}

const diaUTC = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
/** Dias entre duas datas AAAA-MM-DD (sem sinal). */
const distanciaDias = (a: string, b: string) => Math.abs(diaUTC(a) - diaUTC(b)) / 86_400_000;

// ---------- juros ----------

/** Valor presente de `n` parcelas fixas `p` à taxa `i` ao mês (tabela Price). Sem juros, a soma. */
const valorPresente = (p: number, i: number, n: number) => (i > 0 ? (p * (1 - Math.pow(1 + i, -n))) / i : p * n);

/** Taxa ao mês (fração): a cadastrada; sem ela, a implícita do contrato; senão desconhecida. */
function taxaDa(d: Divida): number | null {
  if (d.taxa_mensal != null) return d.taxa_mensal / 100;
  if (d.valor_contratado && d.parcelas_total && d.parcela_valor && d.parcelas_total >= (d.parcelas_restantes ?? 0)) return taxaImplicita(d.valor_contratado, d.parcelas_total, d.parcela_valor);
  return null;
}

/** "6,3%" (uma casa no máximo). */
export const pct = (taxa: number) => `${(Math.round(taxa * 1000) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

// ---------- lista única ----------

export interface DividaVista {
  id: string;
  origem: "cadastrada" | "cartao" | "pessoa";
  tipo: string;
  nome: string;
  parcela: number | null;
  restantes: number;
  total: number | null;
  pagas: number | null;
  /** Data AAAA-MM-DD; nas compras do cartão, só o mês da fatura (AAAA-MM). */
  proxima: { valor: number; data: string } | null;
  /** Fração ao mês; null = desconhecida. */
  taxa: number | null;
  quitarHoje: number;
  ateOFim: number;
  juros: number;
  /** Mês da última parcela (AAAA-MM); null quando não há parcelas. */
  fim: string | null;
  atraso: boolean;
  etiqueta: "atraso" | "juros_altos" | "sem_juros" | null;
  /** Do mais recente para o mais antigo. */
  pagamentos: { data: string; valor: number; texto: string }[];
}

const etiquetaDe = (atraso: boolean, taxa: number | null): DividaVista["etiqueta"] =>
  atraso ? "atraso" : taxa === null ? null : taxa >= JUROS_ALTOS - FOLGA ? "juros_altos" : taxa <= FOLGA ? "sem_juros" : null;

const maisRecentes = <T extends { data: string }>(l: T[]) => [...l].sort((a, b) => b.data.localeCompare(a.data));

/** Dívidas cadastradas que entram na lista: o saldo da fatura do cartão vindo do banco fica de fora (as parcelas dele vêm do cartão). */
const entraNaLista = (d: Divida) => d.situacao !== "quitada" && (informada(d) || d.tipo !== "cartao_de_credito");

type PorId = Map<string, Movimentacao>;

function vistaCadastrada(d: Divida, b: Brutos, hoje: string, porId: PorId): DividaVista | null {
  const temParcelas = (d.parcelas_restantes ?? 0) > 0 && (d.parcela_valor ?? 0) > 0;
  const saldo = ultimoSaldo(d)?.saldo_devedor ?? 0;
  const taxa = taxaDa(d);
  const parcela = temParcelas ? d.parcela_valor! : null;
  const restantes = temParcelas ? d.parcelas_restantes! : 0;
  const total = temParcelas && d.parcelas_total && d.parcelas_total >= restantes ? d.parcelas_total : null;
  const ateOFim = r2(parcela !== null ? parcela * restantes : saldo);
  if (ateOFim <= CENTAVO) return null;
  const quitarHoje = r2(parcela !== null ? valorPresente(parcela, taxa ?? 0, restantes) : saldo);
  const inicio = d.proximo_vencimento ? d.proximo_vencimento.slice(0, 7) : addMes(hoje.slice(0, 7), 1);
  const pagamentos = d.pagamentos ?? [];
  const venc = d.proximo_vencimento;
  // Ligar um pagamento sempre avança o próximo vencimento: se ele já passou, a parcela está em aberto.
  const atraso =
    /atras/i.test(d.situacao ?? "") ||
    (parcela !== null && !!venc && venc < hoje) ||
    (parcela === null && !!d.vencimento_original && d.vencimento_original < hoje);
  return {
    id: d.id,
    origem: "cadastrada",
    tipo: tipoDaDivida(d, b.dividasTipos ?? []),
    nome: d.nome ?? d.credor,
    parcela,
    restantes,
    total,
    pagas: total !== null ? total - restantes : null,
    proxima: parcela !== null && venc ? { valor: parcela, data: venc } : null,
    taxa,
    quitarHoje,
    ateOFim,
    juros: r2(Math.max(0, ateOFim - quitarHoje)),
    fim: parcela !== null ? addMes(inicio, restantes - 1) : null,
    atraso,
    etiqueta: etiquetaDe(atraso, taxa),
    pagamentos: maisRecentes(
      pagamentos.map((p) => {
        const m = porId.get(p.lancamento_id);
        return { data: p.data, valor: r2(Math.abs(p.valor)), texto: m?.nome?.trim() || m?.descricao || "Pagamento" };
      }),
    ),
  };
}

function vistasCartao(b: Brutos, hoje: string, porId: PorId): DividaVista[] {
  return parcelasCartao(b, hoje)
    .filter((p) => p.restantes > 0)
    .map((p) => {
      const ateOFim = r2(p.saldo);
      const vistos = p.ids.map((id) => porId.get(id)).filter((m): m is Movimentacao => !!m && m.status !== "pendente");
      return {
        id: `cartao:${p.chave}`,
        origem: "cartao" as const,
        tipo: "cartao",
        nome: p.descricao,
        parcela: p.valor,
        restantes: p.restantes,
        total: p.total,
        pagas: p.total !== null ? p.total - p.restantes : null,
        proxima: { valor: p.valor, data: p.meses[0] },
        taxa: 0,
        quitarHoje: ateOFim,
        ateOFim,
        juros: 0,
        fim: ultimo(p.meses) ?? null,
        atraso: false,
        etiqueta: "sem_juros" as const,
        pagamentos: maisRecentes(vistos.map((m) => ({ data: m.data, valor: r2(-m.valor), texto: `Parcela ${m.parcela}` }))),
      };
    });
}

function vistasPessoas(b: Brutos, hoje: string): DividaVista[] {
  return porPessoa(b.emprestimos, "eu_devo")
    .filter((p) => p.total > CENTAVO)
    .map((p) => {
      const atraso = p.emprestimos.some((e) => vencido(e, hoje));
      const comVencimento = p.emprestimos.filter((e) => aberto(e) && e.vencimento).sort((a, c) => a.vencimento!.localeCompare(c.vencimento!));
      const prox = comVencimento[0];
      return {
        id: `pessoa:${p.nome.toLocaleLowerCase("pt-BR")}`,
        origem: "pessoa" as const,
        tipo: "pessoas",
        nome: p.nome,
        parcela: null,
        restantes: 0,
        total: null,
        pagas: null,
        proxima: prox ? { valor: falta(prox), data: prox.vencimento! } : null,
        taxa: 0,
        quitarHoje: p.total,
        ateOFim: p.total,
        juros: 0,
        fim: null,
        atraso,
        etiqueta: etiquetaDe(atraso, 0),
        pagamentos: maisRecentes(p.emprestimos.flatMap((e) => (e.pagamentos ?? []).map((pg) => ({ data: pg.data, valor: r2(pg.valor), texto: pg.obs?.trim() || e.descricao?.trim() || "Pagamento" })))),
      };
    });
}

/** Todas as dívidas em aberto: cadastradas, compras parceladas no cartão e o que você deve a pessoas. */
export function juntarDividas(b: Brutos, hoje: string): DividaVista[] {
  const porId: PorId = new Map(b.movimentacoes.map((m) => [m.id, m]));
  const cadastradas = b.dividas.filter(entraNaLista).map((d) => vistaCadastrada(d, b, hoje, porId)).filter((v): v is DividaVista => v !== null);
  return [...cadastradas, ...vistasCartao(b, hoje, porId), ...vistasPessoas(b, hoje)];
}

// ---------- resumo do topo ----------

/** Média do salário líquido: últimos 3 meses com holerite; sem holerite, a receita `salario` dos 3 meses anteriores. */
function salarioMedio(b: Brutos, hoje: string): number | null {
  const mesHoje = hoje.slice(0, 7);
  const porMes = new Map<string, number>();
  for (const h of b.holerites) {
    if (h.competencia > mesHoje) continue;
    porMes.set(h.competencia, (porMes.get(h.competencia) ?? 0) + (h.liquido_competencia ?? h.liquido));
  }
  const meses = [...porMes.keys()].sort().slice(-3);
  if (meses.length) {
    const media = meses.reduce((s, m) => s + porMes.get(m)!, 0) / meses.length;
    if (media > CENTAVO) return media;
  }
  const anteriores = [1, 2, 3].map((n) => addMes(mesHoje, -n));
  const receitas = new Map<string, number>();
  for (const m of b.movimentacoes) {
    if (m.natureza !== "receita" || m.categoria !== "salario" || m.duplicada) continue;
    const mes = m.competencia ?? m.data.slice(0, 7);
    if (anteriores.includes(mes)) receitas.set(mes, (receitas.get(mes) ?? 0) + m.valor);
  }
  const vals = [...receitas.values()].filter((x) => x > CENTAVO);
  return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
}

/** Os números do topo da tela. `peso` é fração (0,3 = 30%); null sem salário para comparar. */
export function resumo(v: DividaVista[], b: Brutos, hoje: string) {
  const proximoMes = addMes(hoje.slice(0, 7), 1);
  const parceladas = v.filter((x) => x.parcela !== null && x.fim !== null);
  const parcelasDoMes = r2(
    parceladas.filter((x) => addMes(x.fim!, -(x.restantes - 1)) <= proximoMes && proximoMes <= x.fim!).reduce((s, x) => s + x.parcela!, 0),
  );
  const salario = salarioMedio(b, hoje);
  return {
    deve: r2(v.reduce((s, x) => s + x.ateOFim, 0)),
    juros: r2(v.reduce((s, x) => s + x.juros, 0)),
    peso: salario ? parcelasDoMes / salario : null,
    parcelasDoMes,
    livre: parceladas.reduce<string | null>((m, x) => (m === null || x.fim! > m ? x.fim : m), null),
    semData: v.filter((x) => x.parcela === null).length,
  };
}

// ---------- pagamentos achados no banco ----------

/**
 * Lançamentos que parecem a parcela de uma dívida cadastrada: gasto (ou pagamento de dívida) sem
 * vínculo, depois do último saldo informado, até 10 dias antes ou depois de um vencimento (o
 * próximo ou os 2 anteriores), com valor a no máximo 2% (ou R$ 1,00) da parcela, e que você não
 * disse que não é. `n` é a parcela que o
 * pagamento baixaria (null sem o total do contrato). Do lançamento mais recente para o mais antigo.
 */
export interface SugestaoPagamento {
  lancamento: Movimentacao;
  divida: DividaVista;
  n: number | null;
  t: number | null;
}

export function sugestoesPagamento(b: Brutos, hoje: string): SugestaoPagamento[] {
  const vistas = new Map(juntarDividas(b, hoje).map((v) => [v.id, v]));
  const recusado = new Set((b.dividasRecusados ?? []).map((r) => `${r.divida}|${r.lancamento}`));
  const livres = b.movimentacoes.filter((m) => (m.natureza === "despesa" || m.natureza === "pagamento_divida") && !m.vinculo && !m.parcela && !m.duplicada && m.valor < 0);
  // Um lançamento vira no máximo uma sugestão: a da parcela de valor mais próximo e, empatando, do vencimento mais perto.
  const melhor = new Map<string, { s: SugestaoPagamento; difValor: number; difDias: number }>();
  for (const d of b.dividas) {
    const v = vistas.get(d.id);
    if (!v || v.origem !== "cadastrada" || v.parcela === null || !d.proximo_vencimento) continue;
    const vencimentos = [0, -1, -2].map((n) => somarMesesData(d.proximo_vencimento!, n));
    const tolerancia = Math.max(0.02 * v.parcela, 1);
    for (const m of livres) {
      if (recusado.has(`${d.id}|${m.id}`) || !depoisDoSaldoInformado(d, m.data)) continue;
      const difValor = Math.abs(Math.abs(m.valor) - v.parcela);
      if (difValor > tolerancia + FOLGA) continue;
      const difDias = Math.min(...vencimentos.map((venc) => distanciaDias(m.data, venc)));
      if (difDias > JANELA_DIAS) continue;
      const atual = melhor.get(m.id);
      if (atual && (atual.difValor < difValor - FOLGA || (Math.abs(atual.difValor - difValor) <= FOLGA && atual.difDias <= difDias))) continue;
      melhor.set(m.id, { s: { lancamento: m, divida: v, n: v.pagas !== null ? v.pagas + 1 : null, t: v.total }, difValor, difDias });
    }
  }
  return [...melhor.values()].map((x) => x.s).sort((a, c) => c.lancamento.data.localeCompare(a.lancamento.data));
}

// ---------- ordem e simulador ----------

/** Ordem para quitar: juros do maior para o menor; depois em atraso; depois sem juros; depois juros desconhecidos. */
export function ordemSugerida(v: DividaVista[]): { divida: DividaVista; motivo: string }[] {
  const porValor = (a: DividaVista, c: DividaVista) => c.ateOFim - a.ateOFim;
  const comJuros = v.filter((x) => x.taxa !== null && x.taxa > FOLGA).sort((a, c) => c.taxa! - a.taxa! || porValor(a, c));
  const resto = v.filter((x) => !comJuros.includes(x));
  const atrasadas = resto.filter((x) => x.atraso).sort(porValor);
  const semJuros = resto.filter((x) => !x.atraso && x.taxa !== null).sort(porValor);
  const desconhecidas = resto.filter((x) => !x.atraso && x.taxa === null).sort(porValor);
  return [
    ...comJuros.map((divida, i) => ({ divida, motivo: i === 0 ? `${pct(divida.taxa!)} ao mês é o juro mais caro` : `${pct(divida.taxa!)} ao mês` })),
    ...atrasadas.map((divida) => ({ divida, motivo: "em atraso, a multa cresce" })),
    ...semJuros.map((divida) => ({ divida, motivo: divida.origem === "pessoa" ? "sem juros, combine com a pessoa" : "sem juros, siga as parcelas" })),
    ...desconhecidas.map((divida) => ({ divida, motivo: "juros desconhecidos" })),
  ];
}

/**
 * "E se eu adiantar?": o valor vai para a dívida parcelada de maior taxa e abate o saldo (tabela
 * Price, parcela fixa, prazo menor). Mostra os juros economizados e os meses a menos; se der para
 * quitar, a sobra vai para a próxima da ordem. null quando não há valor a adiantar.
 */
export function simularAdiantar(
  v: DividaVista[],
  extra: number,
): { alvo: DividaVista | null; economia: number; mesesAMenos: number; quita: boolean; sobra: number; proxima: DividaVista | null } | null {
  if (!(extra > CENTAVO)) return null;
  const ordem = ordemSugerida(v).map((o) => o.divida);
  const alvo = ordem.find((x) => x.taxa !== null && x.taxa > FOLGA && x.parcela !== null && x.restantes > 0) ?? null;
  if (!alvo) return { alvo: null, economia: 0, mesesAMenos: 0, quita: false, sobra: 0, proxima: null };
  const i = alvo.taxa!;
  const p = alvo.parcela!;
  if (extra >= alvo.quitarHoje - CENTAVO) {
    return {
      alvo,
      economia: alvo.juros,
      mesesAMenos: alvo.restantes,
      quita: true,
      sobra: r2(Math.max(0, extra - alvo.quitarHoje)),
      proxima: ordem.find((x) => x !== alvo) ?? null,
    };
  }
  // Depois de adiantar, paga a mesma parcela até zerar; a última pode ser menor.
  let saldo = alvo.quitarHoje - extra;
  let meses = 0;
  let pago = 0;
  while (saldo > CENTAVO && meses < alvo.restantes) {
    const devido = saldo * (1 + i);
    const pagamento = Math.min(p, devido);
    pago += pagamento;
    saldo = devido - pagamento;
    meses++;
  }
  return { alvo, economia: r2(Math.max(0, alvo.ateOFim - extra - pago)), mesesAMenos: alvo.restantes - meses, quita: false, sobra: 0, proxima: null };
}
