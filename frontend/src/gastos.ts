import { addMes } from "./formato";
import { ehGasto, partesDe } from "./grupos";

/** O mínimo de um lançamento que as contas por categoria usam. */
export interface Lanc {
  data: string;
  descricao: string;
  valor: number;
  natureza: string;
  categoria?: string | null;
  competencia?: string | null;
  partes?: { valor: number; categoria: string }[] | null;
}

export const compDe = (m: Lanc) => m.competencia ?? m.data.slice(0, 7);
export { ehGasto };
export const catDe = (m: Lanc) => m.categoria || "a_classificar";

/** O lançamento tem essa categoria (inteiro ou em alguma parte). */
export const temCategoria = (m: Lanc | Parameters<typeof partesDe>[0], categoria: string) => partesDe(m).some((p) => p.categoria === categoria);

/** Gasto por categoria (positivo = dinheiro que saiu), cada parte no seu grupo. Só gastos contam. */
export function gastoPorParte(movs: (Parameters<typeof partesDe>[0] & { natureza: string })[]): Map<string, number> {
  const t = new Map<string, number>();
  for (const m of movs) {
    if (!ehGasto(m)) continue;
    for (const p of partesDe(m)) t.set(p.categoria, r2((t.get(p.categoria) ?? 0) - p.valor));
  }
  return t;
}

/** Os meses do período: os últimos 12 até `mesAtual`, ou o ano escolhido (sem passar do mês atual). */
export function mesesDaJanela(janela: "12" | number, mesAtual: string): string[] {
  if (janela === "12") return Array.from({ length: 12 }, (_, i) => addMes(mesAtual, i - 11));
  const fim = `${janela}-12` > mesAtual ? mesAtual : `${janela}-12`;
  const l: string[] = [];
  for (let m = `${janela}-01`; m <= fim; m = addMes(m, 1)) l.push(m);
  return l;
}

export interface ResumoCategoria {
  categoria: string;
  total: number;
  /** Gasto em cada mês da janela, na mesma ordem. */
  porMes: number[];
  lancamentos: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Gasto por categoria (positivo = dinheiro que saiu) mês a mês, da maior para a menor. */
export function resumoPorCategoria(movs: Lanc[], meses: string[]): ResumoCategoria[] {
  const idx = new Map(meses.map((m, i) => [m, i]));
  const t = new Map<string, ResumoCategoria>();
  for (const m of movs) {
    if (!ehGasto(m)) continue;
    const i = idx.get(compDe(m));
    if (i === undefined) continue;
    for (const p of partesDe(m)) {
      const c = p.categoria;
      let r = t.get(c);
      if (!r) t.set(c, (r = { categoria: c, total: 0, porMes: meses.map(() => 0), lancamentos: 0 }));
      r.porMes[i] -= p.valor;
      r.total -= p.valor;
      r.lancamentos++;
    }
  }
  return [...t.values()]
    .map((r) => ({ ...r, total: r2(r.total), porMes: r.porMes.map(r2) }))
    .filter((r) => r.total > 0.004)
    .sort((a, b) => b.total - a.total);
}

/**
 * Meses da janela que têm algum lançamento (de qualquer categoria). A média usa só esses,
 * para que meses antes do primeiro dado não puxem a média para baixo.
 */
export function mesesComDados(movs: Lanc[], meses: string[]): number {
  const tem = new Set(movs.map(compDe));
  return meses.filter((m) => tem.has(m)).length;
}

/** "UBER *TRIP 12/03" → "UBER TRIP": junta compras do mesmo lugar. */
export function lugar(descricao: string): string {
  return (
    descricao
      .toUpperCase()
      .replace(/\b(PARC(ELA)?\s*)?\d{1,2}\s*\/\s*\d{1,2}\b/g, " ")
      .replace(/[*\-_.]/g, " ")
      .replace(/\b\d+\b/g, " ")
      .replace(/\s+/g, " ")
      .trim() || descricao.trim()
  );
}

/** Onde mais gastou numa categoria: lugares agrupados, do maior para o menor. */
export function ondeMaisGastou(movs: Lanc[], categoria: string, meses: string[]): { lugar: string; total: number; vezes: number }[] {
  const janela = new Set(meses);
  const t = new Map<string, { lugar: string; total: number; vezes: number }>();
  for (const m of movs) {
    if (!ehGasto(m) || !janela.has(compDe(m))) continue;
    for (const p of partesDe(m)) {
      if (p.categoria !== categoria) continue;
      const k = lugar(m.descricao);
      const r = t.get(k) ?? { lugar: k, total: 0, vezes: 0 };
      r.total = r2(r.total - p.valor);
      r.vezes++;
      t.set(k, r);
    }
  }
  return [...t.values()].filter((r) => r.total > 0.004).sort((a, b) => b.total - a.total);
}
