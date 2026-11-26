import { semCategoria } from "./grupos";
/** Regras da navegação nova: endereços, menus, mês vizinho, pendentes e valor digitado. */

export type Tela = "inicio" | "movimentos" | "dividas" | "objetivos" | "analises" | "fixas" | "pessoas" | "categorias" | "salarios" | "ajustes" | "mais" | "fechamento";

/** As telas que aparecem nos menus (o fechamento só se abre por link). */
export type TelaDeMenu = Exclude<Tela, "fechamento">;

const TELAS: Tela[] = ["inicio", "movimentos", "dividas", "objetivos", "analises", "fixas", "pessoas", "categorias", "salarios", "ajustes", "mais", "fechamento"];

/** Endereços antigos que continuam funcionando. */
const ANTIGOS: Record<string, Tela> = {
  visao: "inicio",
  gastos: "movimentos",
  enviar: "ajustes",
  metas: "objetivos",
};

export const MENU_PRINCIPAL: [TelaDeMenu, string][] = [
  ["inicio", "Início"],
  ["movimentos", "Movimentos"],
  ["dividas", "Dívidas"],
  ["objetivos", "Objetivos"],
  ["analises", "Análises"],
];
export const MENU_ORGANIZAR: [TelaDeMenu, string][] = [
  ["fixas", "Contas fixas"],
  ["pessoas", "Pessoas"],
];
export const MENU_FIM: [TelaDeMenu, string][] = [
  ["categorias", "Categorias"],
  ["salarios", "Salários"],
  ["ajustes", "Ajustes"],
];
/** Lista da tela "Mais" do celular. */
export const MENU_MAIS: [TelaDeMenu, string][] = [
  ["dividas", "Dívidas"],
  ["analises", "Análises"],
  ["fixas", "Contas fixas"],
  ["pessoas", "Pessoas"],
  ["categorias", "Categorias"],
  ["ajustes", "Ajustes"],
  ["salarios", "Salários"],
];

function partir(hash: string): { nome: string; detalhe: string | null } {
  const limpo = hash.replace(/^#/, "");
  const i = limpo.indexOf("/");
  if (i < 0) return { nome: limpo, detalhe: null };
  return { nome: limpo.slice(0, i), detalhe: limpo.slice(i + 1) || null };
}

function resolver(nome: string): Tela | null {
  if ((TELAS as string[]).includes(nome)) return nome as Tela;
  return ANTIGOS[nome] ?? null;
}

export function telaDoEndereco(hash: string): { tela: Tela; detalhe: string | null } {
  const { nome, detalhe } = partir(hash);
  return { tela: resolver(nome) ?? "inicio", detalhe };
}

/** O endereço novo quando o atual é antigo ou desconhecido; `null` se já está certo. */
export function enderecoCanonico(hash: string): string | null {
  const { nome, detalhe } = partir(hash);
  const tela = resolver(nome);
  if (tela === null) return "#inicio";
  if (tela === nome) return null;
  return `#${tela}${detalhe ? "/" + detalhe : ""}`;
}

/** Qual item da barra de baixo fica aceso para cada tela. */
export function abaDoCelular(t: Tela): "inicio" | "movimentos" | "objetivos" | "mais" {
  if (t === "inicio" || t === "movimentos" || t === "objetivos") return t;
  return "mais";
}

/** Anda um mês (ou um ano, quando o período é o ano inteiro). */
export function mesVizinho(ano: number, mes: number | null, passo: 1 | -1): { ano: number; mes: number | null } {
  if (mes === null) return { ano: ano + passo, mes: null };
  const novo = mes + passo;
  if (novo > 12) return { ano: ano + 1, mes: 1 };
  if (novo < 1) return { ano: ano - 1, mes: 12 };
  return { ano, mes: novo };
}

/**
 * Período para o qual mudar depois de lançar algo com data `data` (AAAA-MM-DD), para que o lançamento apareça
 * na lista. `null` quando o período visto já o mostra (ou a data não é válida).
 */
export function periodoDoLancamento(data: string, ano: number, mes: number | null): { ano: number; mes: number } | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(data);
  if (!m) return null;
  const a = Number(m[1]);
  const ms = Number(m[2]);
  if (ms < 1 || ms > 12) return null;
  if (a === ano && (mes === null || mes === ms)) return null;
  return { ano: a, mes: ms };
}

type Pendente = { natureza: string; categoria?: string | null; data: string; competencia?: string | null };

/** Lançamentos do período (receita, despesa ou estorno) que ainda esperam categoria. */
function pendentesDoPeriodo<T extends Pendente>(movs: T[], ano: number, mes: number | null): T[] {
  const prefixo = mes === null ? String(ano) : `${ano}-${String(mes).padStart(2, "0")}`;
  return movs.filter((m) => {
    if (!semCategoria(m)) return false;
    const comp = m.competencia ?? m.data.slice(0, 7);
    return comp.startsWith(prefixo);
  });
}

/** Quantos lançamentos do período ainda esperam categoria. */
export function contarPendentes(movs: Pendente[], ano: number, mes: number | null): number {
  return pendentesDoPeriodo(movs, ano, mes).length;
}

/** Para onde leva quem quer organizar os pendentes: Movimentos, na aba Tudo, só os sem categoria (gastos e entradas). */
export function destinoPendentes(): "#movimentos/pendentes" {
  return "#movimentos/pendentes";
}

/** Maior valor aceito num lançamento manual (o servidor recusa acima disso). */
export const VALOR_MAXIMO = 1_000_000;

/**
 * Lê um valor digitado em reais ("1.234,56", "12,5", "12.50"). Inválido, ambíguo ("1,234.56") ou que vira
 * zero ao arredondar para centavos ("0,001") vira `null`. O teto de valor fica com quem usa.
 */
export function lerValor(txt: string): number | null {
  const t = txt.trim().replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(t)) return null;
  let norm: string;
  const virgula = t.indexOf(",");
  // "1,234.56" (ponto depois da vírgula) é ambíguo: melhor recusar do que gravar outro valor.
  if (virgula >= 0 && t.indexOf(".", virgula) >= 0) return null;
  if (virgula >= 0) {
    norm = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+\.\d{1,2}$/.test(t)) {
    norm = t;
  } else {
    norm = t.replace(/\./g, "");
  }
  const n = Number(norm);
  if (!Number.isFinite(n)) return null;
  const arredondado = Math.round(n * 100) / 100;
  return arredondado > 0 ? arredondado : null;
}
