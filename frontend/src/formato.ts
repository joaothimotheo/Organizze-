export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

// Modo "esconder valores": troca todos os valores em reais por pontos (telas, gráficos e dicas).
let ocultar = false;
export const MASCARA = "R$ •••••";
export function definirOcultar(v: boolean) {
  ocultar = v;
}
export const valoresOcultos = () => ocultar;

export const reais = (v: number) => (ocultar ? MASCARA : brl.format(v));
/** Reais por extenso para mensagens (nunca mascarado), com espaço comum: R$ 1.234,56. */
export const reaisTexto = (v: number) => brl.format(v).replace(/\u00a0/g, " ");
export const reaisCurto = (v: number) => (ocultar ? "•••" : brl0.format(v));
export const numero = (v: number) => num.format(v);

/** "2026-10-09" → "09/10/2026"; "2026-06" → "06/2026" */
export function data(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}/${m}/${a}` : `${m}/${a}`;
}

export const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const CATEGORIAS: Record<string, string> = {
  alimentacao: "Alimentação",
  mercado: "Mercado",
  transporte: "Transporte",
  moradia: "Moradia",
  contas_casa: "Contas da casa",
  lazer: "Lazer",
  maquinas_ursinho: "Máquinas de ursinho",
  saude: "Saúde",
  educacao: "Educação",
  assinaturas: "Assinaturas",
  compras: "Compras",
  servicos: "Serviços",
  impostos: "Impostos e taxas",
  cuidados_pessoais: "Cuidados pessoais",
  tarifas_bancarias: "Tarifas bancárias",
  encargos_financeiros: "Juros e IOF",
  transferencias_pix: "Pix no cartão",
  transferencias: "Transferências",
  investimentos: "Investimentos",
  emprestimos: "Empréstimos",
  salario: "Salário",
  outras_receitas: "Outras receitas",
  pagamento_fatura_cartao: "Pagamento de fatura",
  a_classificar: "A classificar",
  outros: "Outros",
};
type TipoGrupo = "gasto" | "entrada";
/** Ordem para escolher (vem do servidor, com as categorias que você criou). Depois de migrar, cada grupo tem `tipo`. */
let ordem: { id: string; nome: string; tipo?: TipoGrupo }[] = Object.entries(CATEGORIAS).map(([id, nome]) => ({ id, nome }));

export function registrarCategorias(l: { id: string; nome: string; oculta?: boolean; tipo?: string }[]) {
  for (const c of l) CATEGORIAS[c.id] = c.nome;
  if (l.length)
    ordem = l
      .filter((c) => !c.oculta)
      .map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo === "gasto" || c.tipo === "entrada" ? c.tipo : undefined }));
}

/** As categorias já são grupos (modelo novo): cada uma tem um tipo. */
export const categoriasSaoGrupos = () => ordem.some((c) => c.tipo);

/**
 * Categorias que fazem sentido escolher para um lançamento. Com `tipo`, só os grupos daquele
 * tipo; as categorias antigas não têm tipo e aparecem todas.
 */
export const opcoesCategoria = (tipo?: TipoGrupo): [string, string][] =>
  ordem.filter((c) => c.id !== "pagamento_fatura_cartao" && (!tipo || !c.tipo || c.tipo === tipo)).map((c) => [c.id, c.nome]);

/**
 * Texto da opção desabilitada para quando o valor atual não está entre as opções: "Escolha…"
 * se ainda não tem categoria, senão o nome dela. `null` se o valor está na lista.
 */
export const rotuloFora = (valor: string, opcoes: [string, string][]): string | null =>
  opcoes.some(([k]) => k === valor) ? null : !valor || valor === "a_classificar" ? "Escolha…" : (CATEGORIAS[valor] ?? valor);

export const nomeCategoria = (c: string | null | undefined) => (c ? (CATEGORIAS[c] ?? c) : "—");

/** "2026-09" + 2 → "2026-11" */
export function addMes(comp: string, n: number): string {
  let [a, m] = comp.split("-").map(Number);
  m += n;
  a += Math.floor((m - 1) / 12);
  m = (((m - 1) % 12) + 12) % 12 + 1;
  return `${a}-${String(m).padStart(2, "0")}`;
}

/** "2026-09" → "set/26" */
export function mesAno(comp: string | null | undefined): string {
  if (!comp) return "—";
  const [a, m] = comp.split("-");
  return `${MESES_CURTOS[Number(m) - 1]}/${a.slice(2)}`;
}

export function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const porcento = (v: number) => `${num.format(v)}%`;

/** "1.234,56" ou "1234.56" → número; vazio ou inválido → null. */
export function lerValor(v: string): number | null {
  const t = v.trim().replace(/\s|R\$/g, "");
  if (!t) return null;
  // "1.000" e "12.345.678" (ponto de milhar, sem vírgula) também valem como milhar.
  const milhar = /^-?\d{1,3}(\.\d{3})+$/.test(t);
  const n = Number(t.includes(",") || milhar ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}
