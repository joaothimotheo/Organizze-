/**
 * Limites de gasto por categoria: quanto já foi gasto no mês em cada categoria com limite, a
 * previsão para o fim do mês no ritmo atual e as categorias que dá para limitar (com uma sugestão
 * de limite pela média dos 3 meses anteriores).
 */
import type { Brutos, Grupo } from "./api";
import { addMes, nomeCategoria } from "./formato";
import { gastoPorParte } from "./gastos";

export type Situacao = "ok" | "vai_passar" | "perto" | "passou";

export interface LinhaLimite {
  categoria: string;
  nome: string;
  cor: string | null;
  limite: number;
  gasto: number;
  /** Gasto / limite, em %. */
  pct: number;
  /** Quanto ainda cabe (negativo = passou). */
  restante: number;
  /** No mês de hoje: o gasto no fim do mês no ritmo atual. Em outro mês, null. */
  previsto: number | null;
  situacao: Situacao;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const compDe = (m: { data: string; competencia?: string | null }) => m.competencia ?? m.data.slice(0, 7);
const diasNoMes = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();

/** Categorias que não são gasto do dia a dia (antes de migrar para grupos). */
const FORA = new Set([
  "a_classificar",
  "salario",
  "outras_receitas",
  "outras_entradas",
  "rendimentos_estornos",
  "transferencias",
  "transferencias_pix",
  "investimentos",
  "emprestimos",
  "pagamento_fatura_cartao",
]);

function nomeECor(b: Brutos) {
  const grupos = new Map((b.categorias as unknown as Grupo[]).map((g) => [g.id, g]));
  return (id: string) => {
    const g = grupos.get(id);
    return b.categoriasMigradas ? { nome: g?.nome ?? nomeCategoria(id), cor: g?.cor ?? null } : { nome: g?.nome ?? nomeCategoria(id), cor: null };
  };
}

function gastoNoMes(b: Brutos, mes: string): Map<string, number> {
  return gastoPorParte(b.movimentacoes.filter((m) => compDe(m) === mes));
}

/** Situação de cada categoria com limite no mês, da mais apertada para a mais folgada. */
export function limitesDoMes(b: Brutos, mes: string, hoje: string): LinhaLimite[] {
  const gasto = gastoNoMes(b, mes);
  const info = nomeECor(b);
  const atual = mes === hoje.slice(0, 7);
  const dia = Number(hoje.slice(8, 10));
  const ordem: Record<Situacao, number> = { passou: 0, perto: 1, vai_passar: 2, ok: 3 };
  return (b.limites ?? [])
    .filter((l) => l.limite > 0)
    .map((l) => {
      const g = r2(gasto.get(l.categoria) ?? 0);
      const pct = Math.round((g / l.limite) * 100);
      const previsto = atual ? r2((g / dia) * diasNoMes(mes)) : null;
      const situacao: Situacao =
        g > l.limite + 0.004 ? "passou" : g >= l.limite * 0.8 ? "perto" : previsto !== null && dia >= 5 && previsto > l.limite * 1.05 ? "vai_passar" : "ok";
      return { categoria: l.categoria, ...info(l.categoria), limite: l.limite, gasto: g, pct, restante: r2(l.limite - g), previsto, situacao };
    })
    .sort((x, y) => ordem[x.situacao] - ordem[y.situacao] || y.pct - x.pct || x.nome.localeCompare(y.nome, "pt-BR"));
}

export interface CategoriaLimitavel {
  categoria: string;
  nome: string;
  cor: string | null;
  /** Média por mês dos 3 meses anteriores a `mes`. */
  media: number;
  /** Média arredondada para cima, de 10 em 10 (nada a sugerir: null). */
  sugestao: number | null;
  limite: number | null;
}

/**
 * Categorias de gasto para escolher um limite: depois de migrar, os grupos de gasto; antes, as que
 * tiveram gasto nos 3 meses anteriores. As com limite sempre aparecem. Da média maior para a menor.
 */
export function categoriasLimitaveis(b: Brutos, mes: string): CategoriaLimitavel[] {
  const info = nomeECor(b);
  const meses = [1, 2, 3].map((i) => addMes(mes, -i));
  const soma = new Map<string, number>();
  for (const m of meses) for (const [c, v] of gastoNoMes(b, m)) soma.set(c, (soma.get(c) ?? 0) + v);
  const ids = new Set<string>();
  if (b.categoriasMigradas) {
    for (const g of b.categorias as unknown as Grupo[]) if (g.tipo === "gasto") ids.add(g.id);
  } else {
    for (const [c, v] of soma) if (v > 0.004 && !FORA.has(c)) ids.add(c);
  }
  for (const l of b.limites ?? []) ids.add(l.categoria);
  const limite = new Map((b.limites ?? []).map((l) => [l.categoria, l.limite]));
  return [...ids]
    .map((c) => {
      const media = r2((soma.get(c) ?? 0) / 3);
      return { categoria: c, ...info(c), media, sugestao: media > 0.004 ? Math.ceil(media / 10) * 10 : null, limite: limite.get(c) ?? null };
    })
    .sort((x, y) => y.media - x.media || x.nome.localeCompare(y.nome, "pt-BR"));
}
