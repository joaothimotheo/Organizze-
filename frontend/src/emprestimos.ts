import type { Direcao, Emprestimo } from "./api";

const r2 = (v: number) => Math.round(v * 100) / 100;

export const pago = (e: Emprestimo) => r2((e.pagamentos ?? []).reduce((a, p) => a + p.valor, 0));
export const falta = (e: Emprestimo) => Math.max(0, r2(e.valor - pago(e)));
export const aberto = (e: Emprestimo) => falta(e) > 0.004;
export const vencido = (e: Emprestimo, hoje: string) => aberto(e) && !!e.vencimento && e.vencimento < hoje;

export interface Pessoa {
  nome: string;
  total: number;
  emprestimos: Emprestimo[];
}

/** Empréstimos em aberto numa direção, agrupados por pessoa (maior valor primeiro). */
export function porPessoa(lista: Emprestimo[], direcao: Direcao): Pessoa[] {
  const m = new Map<string, Pessoa>();
  for (const e of lista) {
    if (e.direcao !== direcao || !aberto(e)) continue;
    const chave = e.pessoa.trim().toLocaleLowerCase("pt-BR");
    const p = m.get(chave) ?? { nome: e.pessoa.trim(), total: 0, emprestimos: [] };
    p.total = r2(p.total + falta(e));
    p.emprestimos.push(e);
    m.set(chave, p);
  }
  const l = [...m.values()];
  l.forEach((p) => p.emprestimos.sort((a, b) => a.data.localeCompare(b.data)));
  return l.sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));
}

export const totalEmAberto = (lista: Emprestimo[], direcao: Direcao) =>
  r2(lista.filter((e) => e.direcao === direcao).reduce((a, e) => a + falta(e), 0));
