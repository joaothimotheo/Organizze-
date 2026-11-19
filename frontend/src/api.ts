// Tipos das respostas do back-end (espelham backend/src/calculos.rs e backend/src/importar).
import { registrarCategorias } from "./formato";

export interface Fluxo {
  lancamentos: number;
  receitas: number;
  despesas_consumo: number;
  pagamento_dividas: number;
  aportes: number;
  resgates: number;
  sobra: number;
  tem_estimativa: boolean;
  tem_extrato_receita: boolean;
  receita_estimada_pelo_holerite: boolean;
}

export interface Salario {
  holerites: number;
  bruto: number;
  descontos: number;
  liquido: number;
  tem_estimativa: boolean;
}

export interface PosicaoInvestimentos {
  aplicacoes: number;
  saldo: number;
  aportado: number;
  rendimento: number;
  tem_estimativa: boolean;
  sem_posicao: number;
}

export interface Patrimonio {
  valor: number;
  contas: number;
  investimentos: number;
  dividas: number;
  falta: string[];
  tem_estimativa: boolean;
}

export interface DividaNaData {
  id: string;
  nome: string;
  saldo: number;
  data: string;
  taxa_mensal: number | null;
  estimado: boolean;
}

export interface PontoMensal {
  competencia: string;
  fluxo: Fluxo | null;
  patrimonio: number | null;
  investimentos: PosicaoInvestimentos | null;
}
export interface VisaoGeral {
  periodo: { ano: number; mes: number | null; competencias: string[]; fim: string };
  indicadores: {
    salario: Salario | null;
    fluxo: Fluxo | null;
    investimentos: PosicaoInvestimentos | null;
    dividas_total: number | null;
    dividas_qtd: number;
    dividas_estimado: boolean;
    patrimonio: Patrimonio | null;
  };
  serie_mensal: PontoMensal[];
  ultimos_meses: PontoMensal[];
  despesas_por_categoria: { categoria: string; valor: number }[];
  dividas: DividaNaData[];
  metas: { id: string; nome: string; valor_alvo: number; saldo_reservado: number; percentual: number; prazo: string | null }[];
  anos_disponiveis: number[];
  ultima_competencia_com_dados: string | null;
}

export interface Fonte {
  arquivo: string;
  descricao: string;
  existe: boolean;
  registros: number | null;
  atualizado_em: string | null;
  erro: string | null;
}

export interface RegistroIndicador {
  data: string;
  valor: number;
}

export interface Indicadores {
  atualizado_em?: string | null;
  series?: Record<string, { sgs: number; unidade: string; registros: RegistroIndicador[] }>;
}

export interface ResultadoAtualizacao {
  gravado: boolean;
  consultado_em: string;
  series: { serie: string; sgs: number; ok: boolean; erro: string | null }[];
}

// ---------- dados brutos (arquivos) ----------

export interface Lancamento {
  descricao: string;
  referencia?: string | null;
  valor: number;
  tipo?: string | null;
  natureza?: string | null;
}

export interface Holerite {
  id: string;
  competencia: string;
  tipo?: string | null;
  data_pagamento?: string | null;
  proventos: Lancamento[];
  descontos: Lancamento[];
  bruto: number;
  total_descontos: number;
  liquido: number;
  liquido_competencia?: number | null;
  status?: string;
  origem?: { documento_id?: string };
}

export interface Movimentacao {
  id: string;
  conta_id?: string;
  data: string;
  descricao: string;
  /** O que é este lançamento, escrito por você. A descrição do banco continua em `descricao`. */
  nome?: string | null;
  valor: number;
  natureza: string;
  categoria?: string | null;
  /** Detalhe dentro do grupo. */
  subcategoria?: string | null;
  classificacao?: string | null;
  recorrencia?: string | null;
  competencia?: string | null;
  parcela?: string | null;
  data_compra?: string | null;
  status?: string;
  hash?: string;
  duplicada?: boolean;
  origem?: { documento_id?: string; cartao_final?: string | null };
  /** Lançamento dividido entre grupos; sem isso vale a `categoria` inteira. */
  partes?: ParteLancamento[] | null;
  /** O que este lançamento paga ou devolve (dívida, pessoa…). */
  vinculo?: VinculoLancamento | null;
  /** Para quem foi o gasto, quando você informou. */
  quem?: string | null;
}

export interface ParteLancamento {
  valor: number;
  categoria: string;
  subcategoria?: string | null;
}

export interface VinculoLancamento {
  tipo: string;
  id: string;
  pagamento_id?: string | null;
  ja_paga?: boolean;
  /** Conta fixa: o mês que este lançamento pagou (guardado ao ligar; sem ele, a competência). */
  mes?: string | null;
}

/** O que se pode mudar num lançamento (`partes` e `vinculo` nulos desfazem). */
export interface EdicaoLancamento {
  nome?: string;
  quem?: string | null;
  categoria?: string;
  /** Detalhe do grupo, só junto com `categoria`; vazio limpa (sem ele, escolher a categoria limpa). */
  subcategoria?: string;
  natureza?: string;
  partes?: { valor: number; categoria: string; subcategoria?: string | null }[] | null;
  vinculo?: { tipo: string; id: string } | null;
  mesma_descricao?: boolean;
}

export interface SaldoDivida {
  data: string;
  saldo_devedor: number;
  status?: string;
  fatura?: number;
  parcelas_a_vencer?: number;
  /** De onde veio: informado por você, de um documento ou estimado a partir de um lançamento ligado. */
  origem?: { tipo?: string; id?: string };
}

export interface Divida {
  id: string;
  nome?: string | null;
  credor: string;
  tipo?: string | null;
  valor_contratado?: number | null;
  vencimento_original?: string | null;
  parcelas_restantes?: number | null;
  /** Total de parcelas do contrato. */
  parcelas_total?: number | null;
  parcela_valor?: number | null;
  proximo_vencimento?: string | null;
  taxa_mensal?: number | null;
  obs?: string | null;
  situacao?: string | null;
  origem?: { tipo?: string };
  /** Quando você cadastrou ou editou a dívida (data e hora). */
  informado_em?: string | null;
  saldos: SaldoDivida[];
  /** Lançamentos ligados a esta dívida, cada um pagando uma parcela (ou abatendo o saldo). */
  pagamentos?: PagamentoDivida[];
}

export interface PagamentoDivida {
  lancamento_id: string;
  data: string;
  /** Quanto saiu da conta (como veio do lançamento; pode ser negativo). */
  valor: number;
}

/** Tipo de dívida criado por você (`dividas.json` → `tipos`). */
export interface TipoDivida {
  id: string;
  nome: string;
}

/** Sugestão de pagamento que você disse que não é desta dívida (`dividas.json` → `recusados`). */
export interface RecusaDivida {
  divida: string;
  lancamento: string;
}

export interface Documento {
  id: string;
  tipo: string;
  nome_original?: string;
  sha256?: string;
  original?: string;
  competencia?: string;
  vencimento?: string | null;
  total_fatura?: number | null;
  parcelas_a_vencer?: number | null;
  processado_em?: string;
  instituicao?: string;
}

export interface DescontoTemporario {
  descricao: string;
  previsao_fim?: string | null;
  obs?: string | null;
}

/** De onde vêm os lançamentos: do banco (Open Finance) ou só dos documentos enviados (modelo antigo). */
export type FonteDados = "banco" | "documentos";

export interface Brutos {
  holerites: Holerite[];
  movimentacoes: Movimentacao[];
  dividas: Divida[];
  /** Tipos de dívida criados por você (os padrão ficam em `dividas.ts`). */
  dividasTipos: TipoDivida[];
  /** Pares (dívida, lançamento) que você disse que não combinam. */
  dividasRecusados: RecusaDivida[];
  documentos: Documento[];
  descontosTemporarios: DescontoTemporario[];
  contas: ContaCadastrada[];
  emprestimos: Emprestimo[];
  categorias: CategoriaInfo[];
  metas: Meta[];
  fixas: Fixa[];
  /** Saldo de cada conta no fim de cada mês (da sincronização com o banco). */
  saldosContas: SaldoMensal[];
  /** Sugestões de contas fixas que você mandou não mostrar mais (já canceladas). */
  fixasIgnoradas: string[];
  /** As categorias já viraram grupos (`categorias.json` versão 2). */
  categoriasMigradas: boolean;
}

export interface SaldoMensal {
  conta_id: string;
  competencia: string;
  data?: string;
  saldo_final: number;
}

export type FormaPagamento = "pix" | "cartao" | "debito" | "boleto" | "dinheiro" | "outro";

/** Conta fixa ou assinatura: o que se repete todo mês, inclusive o que é pago por fora do banco. */
export interface Fixa {
  id: string;
  nome: string;
  valor: number;
  dia?: number | null;
  forma: FormaPagamento;
  categoria?: string | null;
  /** Trecho da descrição no banco que identifica o pagamento. */
  busca?: string | null;
  ativa: boolean;
  /** Dia em que você marcou como cancelada ("2026-11-16"). */
  cancelada_em?: string | null;
  /** Meses ("2026-11") marcados como pagos à mão. */
  pagos?: string[];
}

export type NovaFixa = Omit<Fixa, "id" | "pagos" | "cancelada_em">;

export interface Meta {
  id: string;
  nome: string;
  valor_alvo: number;
  saldo_reservado: number;
  prazo?: string | null;
  aporte_mensal_planejado?: number | null;
  /** O progresso acompanha o saldo das contas marcadas como reserva. */
  usar_reserva?: boolean;
}

export type NovaMeta = Omit<Meta, "id">;

export interface CategoriaInfo {
  id: string;
  nome: string;
  /** Criada por você (pode renomear e excluir). */
  propria: boolean;
  /** Fixa e usada nas contas do sistema: não pode ser excluída. */
  protegida?: boolean;
  /** Fixa que você excluiu (só o nome continua valendo para lançamentos antigos). */
  oculta?: boolean;
}

/** Grupo de gasto ou de entrada criado por você (modelo novo, depois de migrar). */
export interface Grupo {
  id: string;
  nome: string;
  tipo: "gasto" | "entrada";
  cor: string;
  detalhes: string[];
  pede_pessoa: boolean;
  padrao: boolean;
}

/** O que se manda para criar ou editar um grupo. */
export interface NovoGrupo {
  nome: string;
  tipo: "gasto" | "entrada";
  cor: string;
  detalhes?: string[];
  pede_pessoa?: boolean;
  /** Só ao criar um grupo de gasto: leva os lançamentos de "Outros" com esse detalhe para o grupo novo. */
  absorver_detalhe?: string;
}

/** Categoria antiga com quanto foi usada nos últimos 12 meses (tela de migração). */
export interface UsoAntigo {
  id: string;
  nome: string;
  usos: number;
  marcada: boolean;
}

// ---------- empréstimos entre pessoas ----------

export type Direcao = "me_deve" | "eu_devo";

export interface PagamentoEmprestimo {
  id: string;
  data: string;
  valor: number;
  obs?: string | null;
}

export interface Emprestimo {
  id: string;
  pessoa: string;
  direcao: Direcao;
  descricao?: string | null;
  valor: number;
  data: string;
  vencimento?: string | null;
  obs?: string | null;
  pagamentos: PagamentoEmprestimo[];
  situacao: "aberto" | "quitado";
}

export interface NovoEmprestimo {
  pessoa: string;
  direcao: Direcao;
  descricao: string | null;
  valor: number;
  data: string;
  vencimento: string | null;
  obs: string | null;
}

export interface ContaCadastrada {
  id: string;
  tipo?: string | null;
  apelido?: string | null;
  instituicao?: string | null;
  final?: string | null;
  /** "reserva" = reserva de emergência, à parte do dia a dia. */
  papel?: "reserva" | null;
  pluggy_id?: string | null;
}

/** Contas correntes marcadas como reserva. */
export const idsReserva = (contas: ContaCadastrada[]) => new Set(contas.filter((c) => c.papel === "reserva").map((c) => c.id));

// ---------- importação ----------

export interface Conferencia {
  descricao: string;
  no_documento: number;
  calculado: number;
  ok: boolean;
}

export interface Previa {
  id: string;
  tipo: "holerite" | "fatura_cartao" | "extrato";
  nome_arquivo: string;
  sha256: string;
  ja_importado: boolean;
  original_guardado: boolean;
  substitui_holerite: boolean;
  duplicadas: number;
  categorias: [string, string][];
  titulo: string;
  competencia: string | null;
  resumo: [string, string][];
  conferencias: Conferencia[];
  avisos: string[];
  holerite: Holerite | null;
  movimentacoes: Movimentacao[];
}

export interface ResultadoImportacao {
  documento_id: string;
  holerite: boolean;
  movimentacoes_gravadas: number;
  movimentacoes_ignoradas: number;
  saldo_divida: boolean;
  original_guardado: boolean;
  so_original: boolean;
}

export interface NovaDivida {
  nome: string;
  credor: string | null;
  tipo: string | null;
  valor_atual: number;
  data_referencia: string;
  valor_original: number | null;
  vencimento_original: string | null;
  parcelas_restantes: number | null;
  parcelas_total: number | null;
  valor_parcela: number | null;
  proximo_vencimento: string | null;
  taxa_mensal: number | null;
  obs: string | null;
}

/** A sessão expirou ou não existe: a interface volta para a tela de login. */
export class SemSessao extends Error {}

let aoPerderSessao: () => void = () => {};
export function quandoPerderSessao(f: () => void) {
  aoPerderSessao = f;
}

export type MetodosLogin = { senha: boolean; google: boolean };

export type ContagemSync = { novas: number; atualizadas: number; removidas: number; cobertas_por_documento: number; ignoradas: number };
export type ConexaoSync = {
  item?: string;
  instituicao?: string | null;
  status?: string | null;
  execucao?: string | null;
  atualizada_na_pluggy_em?: string | null;
  proxima_atualizacao_automatica?: string | null;
  consentimento_ate?: string | null;
  /** Erro ao falar com a Pluggy sobre esta conexão. */
  erro?: string | null;
};
export type ExecucaoSync = {
  em: string;
  ok: boolean;
  erro?: string;
  gravou?: boolean;
  conexao?: ConexaoSync | null;
  /** Todas as conexões (Santander, Mercado Pago…). Execuções antigas só têm `conexao`. */
  conexoes?: ConexaoSync[];
  falhas?: string[];
  transferencias_entre_contas?: number;
  contas?: {
    conta: string;
    conta_id?: string;
    instituicao?: string | null;
    papel?: "reserva" | null;
    erro?: string;
    situacao?: string;
    tipo?: "corrente" | "cartao";
    saldo?: number | null;
    limite?: number | null;
    limite_usado?: number | null;
    vencimento?: string | null;
    fechamento?: string | null;
    contagem?: ContagemSync;
  }[];
};
export type EstadoSync = { configurada: boolean; ultima: ExecucaoSync | null; ultima_ok: ExecucaoSync | null };
export type EstadoSessao = { exigida: boolean; autenticado: boolean; metodos?: MetodosLogin };

/** Endereço da API: vazio quando as telas e a API estão no mesmo servidor. */
export const API = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/$/, "");
/** Link completo para um caminho da API ("/api/backup"), para usar em `href`. */
export const urlApi = (caminho: string) => API + caminho;

/** O servidor está acordando (plano grátis dorme quando fica parado): vale tentar de novo em instantes. */
export class Acordando extends Error {}

/** Repete `f` enquanto o servidor estiver acordando, a cada 3 segundos, por até 2 minutos e meio. */
export async function esperandoAcordar<T>(f: () => Promise<T>, limiteMs = 150_000): Promise<T> {
  const limite = Date.now() + limiteMs;
  for (;;) {
    try {
      return await f();
    } catch (e) {
      if (!(e instanceof Acordando) || Date.now() > limite) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function pedir<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // Cabeçalho exigido pelo back-end em toda gravação (proteção contra outros sites).
  headers.set("x-financeiro", "1");
  if (typeof init.body === "string") headers.set("content-type", "application/json");
  let r: Response;
  try {
    // Com a API em outro endereço, o cookie da sessão precisa ir junto ("include").
    r = await fetch(urlApi(url), { ...init, headers, credentials: API ? "include" : "same-origin" });
  } catch {
    throw navigator.onLine === false ? new Error("sem conexão com o servidor") : new Acordando("sem resposta do servidor");
  }
  // Enquanto acorda, quem responde é o Render (página HTML ou 502/503), não a API.
  const json = (r.headers.get("content-type") ?? "").includes("application/json");
  if (!json && (r.ok || r.status === 502 || r.status === 503 || r.status === 504)) throw new Acordando("servidor acordando");
  const corpo = await r.json().catch(() => null);
  if (r.status === 401 && !url.endsWith("/api/sessao")) {
    aoPerderSessao();
    throw new SemSessao(corpo?.erro ?? "entre para continuar");
  }
  if (!r.ok) throw new Error(corpo?.erro ?? `erro ${r.status}`);
  return corpo as T;
}

const lista = <T,>(v: unknown, chave: string): T[] => {
  const x = (v as Record<string, unknown> | null)?.[chave];
  return Array.isArray(x) ? (x as T[]) : [];
};

export const api = {
  sessao: () => pedir<EstadoSessao>("/api/sessao"),
  entrar: (usuario: string, senha: string) => pedir<{ autenticado: boolean }>("/api/sessao", { method: "POST", body: JSON.stringify({ usuario, senha }) }),
  sair: () => pedir<{ autenticado: boolean }>("/api/sessao", { method: "DELETE" }),

  visaoGeral: (ano: number, mes: number | null, fonte: FonteDados = "banco") =>
    pedir<VisaoGeral>(`/api/visao-geral?ano=${ano}${mes ? `&mes=${mes}` : ""}${fonte === "documentos" ? "&fonte=documentos" : ""}`),
  fontes: () => pedir<Fonte[]>("/api/fontes"),
  indicadores: () => pedir<Indicadores | null>("/api/dados/indicadores"),
  sincronizacao: () => pedir<EstadoSync>("/api/sincronizacao"),
  /** `dias`: janela forçada (ex.: 365 para buscar o último ano de novo). */
  sincronizar: (dias?: number) => pedir<ExecucaoSync>("/api/sincronizar", { method: "POST", ...(dias ? { body: JSON.stringify({ dias }) } : {}) }),
  atualizarIndicadores: () => pedir<ResultadoAtualizacao>("/api/indicadores/atualizar", { method: "POST" }),

  /** `documentos`: modelo antigo, sem o que veio da sincronização com o banco. */
  async brutos(fonte: FonteDados = "banco"): Promise<Brutos> {
    const q = fonte === "documentos" ? "?fonte=documentos" : "";
    const [[h, m, d, doc, cfg, emp, met, fix], cats] = await Promise.all([
      Promise.all(["holerites", "movimentacoes", "dividas", "documentos", "config", "emprestimos", "metas", "fixas"].map((a) => pedir<unknown>(`/api/dados/${a}${q}`))),
      pedir<{ migrado: boolean; grupos: CategoriaInfo[] }>("/api/categorias"),
    ]);
    // Antes e depois de migrar, cada item tem pelo menos `id` e `nome`.
    const categorias = Array.isArray(cats?.grupos) ? cats.grupos : [];
    registrarCategorias(categorias);
    return {
      holerites: lista<Holerite>(h, "holerites"),
      movimentacoes: lista<Movimentacao>(m, "movimentacoes"),
      dividas: lista<Divida>(d, "dividas"),
      dividasTipos: lista<TipoDivida>(d, "tipos"),
      dividasRecusados: lista<RecusaDivida>(d, "recusados"),
      documentos: lista<Documento>(doc, "documentos"),
      descontosTemporarios: lista<DescontoTemporario>(cfg, "descontos_temporarios"),
      contas: lista<ContaCadastrada>(cfg, "contas"),
      emprestimos: lista<Emprestimo>(emp, "emprestimos"),
      categorias,
      metas: lista<Meta>(met, "metas"),
      fixas: lista<Fixa>(fix, "fixas"),
      saldosContas: lista<SaldoMensal>(m, "saldos"),
      fixasIgnoradas: lista<string>(fix, "ignoradas"),
      categoriasMigradas: cats?.migrado === true,
    };
  },

  analisar: (arquivo: File) => {
    const f = new FormData();
    f.append("arquivo", arquivo, arquivo.name);
    return pedir<Previa>("/api/importacoes", { method: "POST", body: f });
  },
  confirmar: (id: string, categorias: Record<string, string>, ignorar: string[]) =>
    pedir<ResultadoImportacao>(`/api/importacoes/${id}/confirmar`, { method: "POST", body: JSON.stringify({ categorias, ignorar }) }),
  descartar: (id: string) => pedir<unknown>(`/api/importacoes/${id}`, { method: "DELETE" }),

  criarMeta: (m: NovaMeta) => pedir<Meta>("/api/metas", { method: "POST", body: JSON.stringify(m) }),
  editarMeta: (id: string, m: NovaMeta) => pedir<Meta>(`/api/metas/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(m) }),
  excluirMeta: (id: string) => pedir<unknown>(`/api/metas/${encodeURIComponent(id)}`, { method: "DELETE" }),
  guardarNaMeta: (id: string, valor: number) => pedir<Meta>(`/api/metas/${encodeURIComponent(id)}/guardar`, { method: "POST", body: JSON.stringify({ valor }) }),

  mudarPapelConta: (id: string, papel: "reserva" | null) =>
    pedir<ContaCadastrada>(`/api/contas/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ papel: papel ?? "dia_a_dia" }) }),

  categorias: () => pedir<{ migrado: boolean; grupos: Grupo[] }>("/api/categorias"),
  usoAntigo: () => pedir<UsoAntigo[]>("/api/categorias/migracao"),
  migrar: (manter: string[]) => pedir<{ grupos: number; movidos: number }>("/api/categorias/migrar", { method: "POST", body: JSON.stringify({ manter }) }),
  criarGrupo: (n: NovoGrupo) => pedir<{ grupo: Grupo; movidos: number }>("/api/categorias", { method: "POST", body: JSON.stringify(n) }),
  editarGrupo: (id: string, n: NovoGrupo) =>
    pedir<Grupo>(`/api/categorias/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(n) }),
  apagarGrupo: (id: string) => pedir<{ movidos: number }>(`/api/categorias/${encodeURIComponent(id)}`, { method: "DELETE" }),
  sugestoes: () => pedir<{ detalhe: string; lancamentos: string[]; total: number }[]>("/api/categorias/sugestoes"),

  criarCategoria: (nome: string) => pedir<CategoriaInfo>("/api/categorias", { method: "POST", body: JSON.stringify({ nome }) }),
  renomearCategoria: (id: string, nome: string) =>
    pedir<CategoriaInfo>(`/api/categorias/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ nome }) }),
  excluirCategoria: (id: string, para: string) =>
    pedir<{ lancamentos_movidos: number }>(`/api/categorias/${encodeURIComponent(id)}?para=${encodeURIComponent(para)}`, { method: "DELETE" }),
  restaurarCategoria: (id: string) => pedir<unknown>(`/api/categorias/${encodeURIComponent(id)}/restaurar`, { method: "POST" }),

  reclassificar: (id: string, categoria: string, mesmaDescricao: boolean) =>
    pedir<{ alterados: string[] }>(`/api/movimentacoes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ categoria, mesma_descricao: mesmaDescricao }) }),

  /** Edita um lançamento: nome, quem, categoria, natureza, partes e vínculo. */
  editarLancamento: (id: string, campos: EdicaoLancamento) =>
    pedir<{ alterados: string[] }>(`/api/movimentacoes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(campos) }),

  /** `nome` vazio apaga o nome e volta a mostrar a descrição do banco. */
  nomear: (id: string, nome: string) =>
    pedir<{ alterados: string[] }>(`/api/movimentacoes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ nome }) }),

  /** Mesmo nome para vários lançamentos (todas as parcelas de uma compra). Vazio apaga. */
  nomearVarios: (ids: string[], nome: string) =>
    pedir<{ alterados: string[] }>("/api/movimentacoes/nomear", { method: "POST", body: JSON.stringify({ ids, nome }) }),

  /** Gasto ou entrada lançado à mão (dinheiro vivo ou algo que o banco não pegou). Entra sem categoria. */
  criarLancamento: (n: { tipo: "gasto" | "entrada"; valor: number; descricao: string; data: string; conta_id: string | null }) =>
    pedir<Movimentacao>("/api/movimentacoes", { method: "POST", body: JSON.stringify(n) }),
  /** Desfaz um lançamento feito à mão (os que vieram do banco não podem ser apagados). */
  apagarLancamento: (id: string) => pedir<unknown>(`/api/movimentacoes/${encodeURIComponent(id)}`, { method: "DELETE" }),

  criarFixa: (f: NovaFixa) => pedir<Fixa>("/api/fixas", { method: "POST", body: JSON.stringify(f) }),
  editarFixa: (id: string, f: NovaFixa) => pedir<Fixa>(`/api/fixas/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(f) }),
  excluirFixa: (id: string) => pedir<unknown>(`/api/fixas/${encodeURIComponent(id)}`, { method: "DELETE" }),
  ignorarSugestao: (chave: string, ignorar: boolean) =>
    pedir<{ ignoradas: string[] }>("/api/fixas/ignoradas", { method: "POST", body: JSON.stringify({ chave, ignorar }) }),
  marcarFixaPaga: (id: string, mes: string, pago: boolean) =>
    pedir<Fixa>(`/api/fixas/${encodeURIComponent(id)}/pago`, { method: "POST", body: JSON.stringify({ mes, pago }) }),

  criarDivida: (d: NovaDivida) => pedir<Divida>("/api/dividas", { method: "POST", body: JSON.stringify(d) }),
  editarDivida: (id: string, d: NovaDivida) => pedir<Divida>(`/api/dividas/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(d) }),
  excluirDivida: (id: string) => pedir<unknown>(`/api/dividas/${encodeURIComponent(id)}`, { method: "DELETE" }),
  criarTipoDivida: (nome: string) => pedir<TipoDivida>("/api/dividas/tipos", { method: "POST", body: JSON.stringify({ nome }) }),
  /** As dívidas do tipo apagado vão para "Outras dívidas". */
  apagarTipoDivida: (id: string) => pedir<{ movidas: number }>(`/api/dividas/tipos/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** "Não é": o lançamento não é desta dívida e a sugestão não volta. */
  recusarSugestao: (dividaId: string, lancamentoId: string) =>
    pedir<{ ok: boolean }>(`/api/dividas/${encodeURIComponent(dividaId)}/recusar`, { method: "POST", body: JSON.stringify({ lancamento_id: lancamentoId }) }),

  criarEmprestimo: (e: NovoEmprestimo) => pedir<Emprestimo>("/api/emprestimos", { method: "POST", body: JSON.stringify(e) }),
  editarEmprestimo: (id: string, e: NovoEmprestimo) => pedir<Emprestimo>(`/api/emprestimos/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(e) }),
  excluirEmprestimo: (id: string) => pedir<unknown>(`/api/emprestimos/${encodeURIComponent(id)}`, { method: "DELETE" }),
  pagarEmprestimo: (id: string, valor: number, data: string, obs: string | null) =>
    pedir<Emprestimo>(`/api/emprestimos/${encodeURIComponent(id)}/pagamentos`, { method: "POST", body: JSON.stringify({ valor, data, obs }) }),
  desfazerPagamento: (id: string, pid: string) =>
    pedir<Emprestimo>(`/api/emprestimos/${encodeURIComponent(id)}/pagamentos/${encodeURIComponent(pid)}`, { method: "DELETE" }),

  restaurarBackup: (conteudo: string) => pedir<{ restaurados: string[] }>("/api/backup", { method: "POST", body: conteudo }),
};
