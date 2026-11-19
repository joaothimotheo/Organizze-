/** Lógica da tela Movimentos: endereços, busca, filtros, lista por dia, resumo por grupo e fila do modo rápido. */
import type { Divida, EdicaoLancamento, Emprestimo, Fixa, Movimentacao, ParteLancamento } from "./api";
import { ehEntrada, ehGasto, partesDe, semCategoria, type Grupo } from "./grupos";
import { capitalizar, lerValor, reaisTexto } from "./formato";

export { partesDe };

export type Aba = "entradas" | "saidas" | "tudo";

export interface Filtro {
  aba: Aba;
  busca: string;
  /** Id da conta, "dinheiro" ou nada. */
  conta: string | null;
  valorMin: 0 | 50 | 100 | 500;
  grupo: string | null;
  soPendentes: boolean;
}

export const FILTRO_VAZIO: Filtro = { aba: "saidas", busca: "", conta: null, valorMin: 0, grupo: null, soPendentes: false };

/**
 * Entende o endereço (#movimentos, #movimentos/entradas, /<grupo>, /pendentes, /<grupo>/mes-a-mes,
 * /lancamento/<id>). `/a_classificar` (endereço da fase 2) vale como `/pendentes`; `/lancamento/<id>`
 * abre a aba Tudo com os detalhes daquele lançamento (`abrir`).
 */
export function rotaMovimentos(hash: string, grupos: Grupo[]): { filtro: Partial<Filtro>; mesAMes: string | null; abrir: string | null } {
  const partes = hash.replace(/^#/, "").split("/").filter(Boolean);
  if (partes[0] === "movimentos") partes.shift();
  const [a, b] = partes;
  const r = (filtro: Partial<Filtro>, mesAMes: string | null = null, abrir: string | null = null) => ({ filtro, mesAMes, abrir });
  if (!a) return r({ aba: "saidas" });
  if (a === "lancamento" && b) return r({ aba: "tudo" }, null, partes.slice(1).join("/"));
  // Antes dos atalhos: "#movimentos/a_classificar/mes-a-mes" é a análise de "Sem categoria".
  if (b === "mes-a-mes") return r({}, a);
  if (a === "entradas" || a === "saidas" || a === "tudo") return r({ aba: a });
  if (a === "pendentes" || a === "a_classificar") return r({ aba: "tudo", soPendentes: true });
  const g = grupos.find((x) => x.id === a);
  // Antes de migrar a categoria não tem tipo: abre em Tudo, filtrada.
  if (g) return r({ aba: g.tipo === "entrada" ? "entradas" : g.tipo === "gasto" ? "saidas" : "tudo", grupo: g.id });
  return r({ aba: "saidas" });
}

/** Endereço que abre os detalhes de um lançamento em Movimentos (de qualquer tela). */
export const linkDetalhes = (id: string) => `#movimentos/lancamento/${encodeURIComponent(id)}`;

/**
 * Ainda falta organizar: gasto ou entrada sem grupo, ou dividido com alguma parte sem grupo
 * (esse se organiza nos detalhes, fora da fila do modo rápido).
 */
export const pendente = (m: Movimentacao) =>
  semCategoria(m) || ((ehGasto(m) || ehEntrada(m)) && !!m.partes?.some((p) => !p.categoria || p.categoria === "a_classificar"));

/** Minúscula, sem acento e com espaços simples. */
export function normalizar(txt: string): string {
  return txt
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

const ehDinheiro = (id?: string | null) => !id || id === "dinheiro";

/** Lançamentos do período da barra do topo (mês de 1 a 12, ou o ano inteiro com `mes` nulo), pela competência. */
export function doPeriodo<T extends { data: string; competencia?: string | null }>(movs: T[], ano: number, mes: number | null): T[] {
  const prefixo = mes === null ? `${ano}-` : `${ano}-${String(mes).padStart(2, "0")}`;
  return movs.filter((m) => (m.competencia ?? m.data.slice(0, 7)).startsWith(prefixo));
}

/** Aplica aba, busca (nome, descrição, quem e conta), conta, valor, grupo e pendentes. */
export function filtrar(movs: Movimentacao[], f: Filtro, nomeConta: (id?: string | null) => string): Movimentacao[] {
  const busca = normalizar(f.busca);
  return movs.filter((m) => {
    if (f.aba === "entradas" && !ehEntrada(m)) return false;
    if (f.aba === "saidas" && !ehGasto(m)) return false;
    if (f.soPendentes && !pendente(m)) return false;
    if (f.conta && (f.conta === "dinheiro" ? !ehDinheiro(m.conta_id) : m.conta_id !== f.conta)) return false;
    if (f.valorMin && !(Math.abs(m.valor) > f.valorMin)) return false;
    if (f.grupo && !partesDe(m).some((p) => p.categoria === f.grupo)) return false;
    if (busca) {
      const palheiro = normalizar([m.nome, m.descricao, m.quem, nomeConta(m.conta_id)].filter(Boolean).join(" "));
      if (!palheiro.includes(busca)) return false;
    }
    return true;
  });
}

/** Agrupa por dia (mais recente primeiro); dentro do dia, o maior valor primeiro. */
export function porDia(movs: Movimentacao[]): { dia: string; itens: Movimentacao[] }[] {
  const t = new Map<string, Movimentacao[]>();
  for (const m of movs) {
    const dia = m.data.slice(0, 10);
    t.set(dia, [...(t.get(dia) ?? []), m]);
  }
  return [...t.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([dia, itens]) => ({ dia, itens: itens.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)) }));
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Total por grupo do tipo pedido, contando cada parte no seu grupo; o maior primeiro. */
export function resumo(movs: Movimentacao[], grupos: Grupo[], tipo: "gasto" | "entrada"): { grupo: Grupo; total: number }[] {
  const total = new Map<string, number>();
  for (const m of movs) {
    if (!(tipo === "gasto" ? ehGasto(m) : ehEntrada(m))) continue;
    for (const p of partesDe(m)) total.set(p.categoria, (total.get(p.categoria) ?? 0) + Math.abs(p.valor));
  }
  return grupos
    .filter((g) => g.tipo === tipo && (total.get(g.id) ?? 0) > 0)
    .map((grupo) => ({ grupo, total: r2(total.get(grupo.id)!) }))
    .sort((a, b) => b.total - a.total);
}

/** Ids dos pendentes (sem grupo), os mais antigos primeiro. Os divididos ficam de fora (organizam-se nos detalhes). */
export function filaRapida(movs: Movimentacao[]): string[] {
  return movs
    .filter((m) => semCategoria(m) && !m.partes?.length)
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))
    .map((m) => m.id);
}

/** Confere se as partes fecham no centavo; mesmas palavras do servidor. */
export function conferirPartes(valor: number, partes: { valor: number }[]): { ok: boolean; texto: string } {
  const soma = Math.round(partes.reduce((s, p) => s + Math.abs(p.valor), 0) * 100);
  const dif = soma - Math.round(Math.abs(valor) * 100);
  if (dif === 0) return { ok: true, texto: "" };
  return { ok: false, texto: `as partes somam ${reaisTexto(soma / 100)}, ${dif < 0 ? "falta" : "passa"} ${reaisTexto(Math.abs(dif) / 100)}` };
}

// ---------- janelas: categoria, detalhes e modo rápido ----------

const conta = (natureza: string) => ehGasto({ natureza }) || ehEntrada({ natureza });

/**
 * Natureza que o lançamento passa a ter ao ganhar um grupo: a dele, se já é gasto ou entrada do
 * mesmo sinal; senão, gasto (despesa) para valor negativo e entrada (receita) para positivo.
 */
export function naturezaParaGrupo(m: { valor: number; natureza: string }): string {
  const saida = m.valor < 0;
  if (saida ? m.natureza === "despesa" : ehEntrada(m)) return m.natureza;
  return saida ? "despesa" : "receita";
}

/** Grupo ou natureza escolhidos numa janela (ainda não salvos). */
export interface Escolha {
  categoria: string;
  natureza: string;
}

/**
 * Aplica uma opção da janela: `nat:<natureza>` muda só a natureza (o que não conta no mês);
 * `cat:<id>` escolhe o grupo e, depois de migrar, devolve o lançamento a gasto ou entrada.
 * Antes de migrar, a categoria antiga muda sozinha, sem mexer na natureza (como sempre foi).
 */
export function aplicarEscolha(m: { valor: number; natureza: string }, atual: Escolha, opcao: string, migrado: boolean): Escolha {
  if (opcao.startsWith("nat:")) return { categoria: atual.categoria, natureza: opcao.slice(4) };
  const categoria = opcao.replace(/^cat:/, "");
  return { categoria, natureza: migrado ? naturezaParaGrupo(m) : atual.natureza };
}

/** Valor da opção marcada para uma escolha: depois de migrar, o que não conta mostra a natureza. */
export function opcaoDaEscolha(e: Escolha, migrado: boolean): string {
  return migrado && !conta(e.natureza) ? `nat:${e.natureza}` : `cat:${e.categoria || "a_classificar"}`;
}

export type TipoVinculo = "divida" | "pessoa" | "fixa";
export interface Ligacao {
  tipo: TipoVinculo;
  id: string;
}

/** "pessoa:e1" ↔ { tipo: "pessoa", id: "e1" }; vazio = nada. */
export const textoLigacao = (v: { tipo: string; id: string } | null | undefined) => (v ? `${v.tipo}:${v.id}` : "");
export function lerLigacao(t: string): Ligacao | null {
  const i = t.indexOf(":");
  if (i < 0) return null;
  const tipo = t.slice(0, i);
  return tipo === "divida" || tipo === "pessoa" || tipo === "fixa" ? { tipo, id: t.slice(i + 1) } : null;
}

/**
 * Opções de "Ligar a", em grupos: as dívidas cadastradas em aberto, só para um gasto (sem o saldo
 * da fatura do cartão vindo do banco, que se paga pelas parcelas); as pessoas do sentido certo (um
 * gasto só paga quem você deve; uma entrada só recebe de quem te deve), em aberto; as contas fixas
 * ativas. O vínculo atual aparece sempre, mesmo quitado ou cancelado.
 */
export function opcoesVinculo(
  m: { valor: number; vinculo?: { tipo: string; id: string } | null },
  fontes: { dividas: Divida[]; emprestimos: Emprestimo[]; fixas: Fixa[] },
): { grupo: string; itens: { valor: string; nome: string }[] }[] {
  const atual = textoLigacao(m.vinculo);
  const gasto = m.valor < 0;
  const direcao = gasto ? "eu_devo" : "me_deve";
  const grupos = [
    {
      grupo: "Dívidas",
      itens: fontes.dividas
        .filter(
          (d) =>
            (gasto && d.situacao !== "quitada" && (d.origem?.tipo === "informado" || d.tipo !== "cartao_de_credito")) || `divida:${d.id}` === atual,
        )
        .map((d) => ({ valor: `divida:${d.id}`, nome: d.nome || d.credor })),
    },
    {
      grupo: "Pessoas",
      itens: fontes.emprestimos
        .filter((e) => (e.direcao === direcao && e.situacao !== "quitado") || `pessoa:${e.id}` === atual)
        .map((e) => ({
          valor: `pessoa:${e.id}`,
          nome: `${e.pessoa}${e.descricao ? `: ${e.descricao}` : ""} (${e.direcao === "eu_devo" ? "você deve" : "te deve"})`,
        })),
    },
    {
      grupo: "Contas fixas",
      itens: fontes.fixas.filter((f) => f.ativa || `fixa:${f.id}` === atual).map((f) => ({ valor: `fixa:${f.id}`, nome: f.nome })),
    },
  ];
  return grupos.filter((g) => g.itens.length > 0);
}

/** Uma linha explicando o que acontece ao salvar com esse vínculo. */
export function efeitoVinculo(tipo: string | null | undefined, entrada: boolean, estavaLigado: boolean): string {
  if (tipo === "fixa") return "Marca a conta fixa como paga no mês deste lançamento.";
  if (tipo === "pessoa") return entrada ? "Registra em Pessoas que essa pessoa te pagou este valor." : "Registra em Pessoas que você pagou este valor a essa pessoa.";
  if (tipo === "divida") return "Baixa uma parcela (ou abate o saldo) desta dívida. Pagamentos de antes do saldo que você informou só entram no histórico.";
  return estavaLigado
    ? "Ao salvar, desfaz o que a ligação fez (pagamento em Pessoas, conta fixa paga ou a baixa na dívida)."
    : "Sem ligação com dívida, pessoa ou conta fixa.";
}

export const MIN_PARTES = 2;
export const MAX_PARTES = 10;

/** Uma linha da divisão como está na tela: valor digitado (sem sinal) e categoria. */
export interface LinhaParte {
  valor: string;
  categoria: string;
  subcategoria?: string | null;
}

/**
 * Lê as linhas da divisão: cada valor com o sinal do lançamento. `ok` só quando são de 2 a 10,
 * nenhuma vazia ou zero e a soma fecha no centavo; `aviso` diz o que falta.
 */
export function lerPartes(valorLanc: number, linhas: LinhaParte[]): { ok: boolean; aviso: string; partes: ParteLancamento[] } {
  const sinal = valorLanc < 0 ? -1 : 1;
  const partes: ParteLancamento[] = [];
  let vazia = false;
  for (const l of linhas) {
    const v = lerValor(l.valor);
    const c = v === null ? 0 : Math.round(Math.abs(v) * 100);
    if (c === 0) vazia = true;
    partes.push({ valor: (sinal * c) / 100, categoria: l.categoria || "a_classificar", ...(l.subcategoria ? { subcategoria: l.subcategoria } : {}) });
  }
  if (linhas.length < MIN_PARTES || linhas.length > MAX_PARTES) return { ok: false, aviso: `Divida em ${MIN_PARTES} a ${MAX_PARTES} partes.`, partes };
  if (vazia) return { ok: false, aviso: "Preencha o valor de cada parte (diferente de zero).", partes };
  const c = conferirPartes(valorLanc, partes);
  return c.ok ? { ok: true, aviso: "As partes fecham com o total.", partes } : { ok: false, aviso: capitalizar(c.texto) + ".", partes };
}

const cent = (v: number) => Math.round(Math.abs(v) * 100);
function mesmasPartes(a: ParteLancamento[] | null | undefined, b: ParteLancamento[] | null | undefined): boolean {
  const x = a?.length ? a : null;
  const y = b?.length ? b : null;
  if (!x || !y) return x === y;
  return x.length === y.length && x.every((p, i) => cent(p.valor) === cent(y[i].valor) && p.categoria === y[i].categoria && (p.subcategoria ?? null) === (y[i].subcategoria ?? null));
}

/** O que foi editado numa janela; `quem` e `vinculo` ausentes = a janela não mexe neles. */
export interface Edicao extends Escolha {
  nome?: string;
  /** Detalhe do grupo escolhido (null = nenhum); ausente = a janela não mexe nele (escolher grupo limpa). */
  subcategoria?: string | null;
  quem?: string;
  /** Com partes, a categoria única é ignorada; `null` = sem divisão. */
  partes: ParteLancamento[] | null;
  vinculo?: Ligacao | null;
}

/**
 * Corpo do PATCH só com o que mudou (nulo se nada mudou). A categoria vai quando muda ou quando o
 * lançamento volta a ser gasto ou entrada; depois de migrar, o que não conta no mês leva só a
 * natureza (o servidor solta o grupo). Tirar a divisão manda `partes: null`. Com `subcategoria` na
 * edição, mudar só o detalhe também conta: vão categoria e detalhe juntos (vazio limpa).
 */
export function corpoEdicao(m: Movimentacao, ed: Edicao, migrado: boolean): EdicaoLancamento | null {
  const corpo: EdicaoLancamento = {};
  if (ed.nome !== undefined && ed.nome.trim() !== (m.nome ?? "").trim()) corpo.nome = ed.nome.trim();
  if (ed.quem !== undefined && ed.quem.trim() !== (m.quem ?? "").trim()) corpo.quem = ed.quem.trim();
  const mudouNatureza = ed.natureza !== m.natureza;
  if (mudouNatureza) corpo.natureza = ed.natureza;
  if (ed.partes) {
    if (!mesmasPartes(ed.partes, m.partes)) corpo.partes = ed.partes;
  } else {
    if (m.partes?.length) corpo.partes = null;
    const detalhe = ed.subcategoria === undefined ? undefined : limparDetalhe(ed.subcategoria);
    const mudouCategoria = ed.categoria !== (m.categoria || "a_classificar") || (detalhe !== undefined && detalhe !== limparDetalhe(m.subcategoria));
    if (conta(ed.natureza) ? mudouCategoria || mudouNatureza : !migrado && mudouCategoria) {
      corpo.categoria = ed.categoria;
      if (detalhe !== undefined) corpo.subcategoria = detalhe;
    }
  }
  if (ed.vinculo !== undefined && textoLigacao(ed.vinculo) !== textoLigacao(m.vinculo)) corpo.vinculo = ed.vinculo;
  return Object.keys(corpo).length ? corpo : null;
}

const limparDetalhe = (d: string | null | undefined) => (d ?? "").split(/\s+/).filter(Boolean).join(" ");

/** Detalhes para escolher num grupo: os dele e, se for outro, o atual (para não sumir da lista). */
export function opcoesDetalhe(detalhes: string[] | undefined, atual: string | null | undefined): string[] {
  const l = [...(detalhes ?? [])];
  const a = limparDetalhe(atual);
  if (a && !l.some((d) => normalizar(d) === normalizar(a))) l.push(a);
  return l;
}

/** Linhas ao começar a dividir: a 1ª com o grupo e o detalhe atuais, a 2ª ainda sem grupo. */
export function linhasAoDividir(categoria: string, subcategoria: string | null | undefined): LinhaParte[] {
  return [
    { valor: "", categoria, subcategoria: subcategoria ?? null },
    { valor: "", categoria: "a_classificar" },
  ];
}

/** Pede "quem" no modo rápido: entradas e Pix (descrição começando com "PIX"). */
export const pedeQuemRapido = (m: { natureza: string; descricao: string }) => ehEntrada(m) || /^\s*pix/i.test(m.descricao);

/**
 * Contagem do modo rápido: organizados = os da fila já resolvidos (por você ou pela mesma
 * descrição); pulados = os pulados que não foram resolvidos depois. Nunca passam do total.
 */
export function contarRapido(fila: string[], resolvidos: Set<string>, pulados: Set<string>): { feitos: number; pulados: number } {
  let f = 0;
  let p = 0;
  for (const id of new Set(fila)) {
    if (resolvidos.has(id)) f++;
    else if (pulados.has(id)) p++;
  }
  return { feitos: f, pulados: p };
}

/** Sobra para a 2ª parte, no formato do campo ("62,45"); vazio se a 1ª não é válida ou não deixa sobra. */
export function sobraParte(valorLanc: number, digitado: string): string {
  const v = lerValor(digitado);
  if (v === null) return "";
  const resto = Math.round(Math.abs(valorLanc) * 100) - Math.round(Math.abs(v) * 100);
  return resto > 0 ? (resto / 100).toFixed(2).replace(".", ",") : "";
}
