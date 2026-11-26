import type { ContaCadastrada, Movimentacao, SaldoMensal } from "./api";
import { addMes } from "./formato";

/** Contas correntes marcadas como reserva. */
export const idsReserva = (contas: ContaCadastrada[]) => new Set(contas.filter((c) => c.papel === "reserva").map((c) => c.id));

const r2 = (v: number) => Math.round(v * 100) / 100;
const ehRendimento = (m: Movimentacao) => m.valor > 0 && /rendiment|remunera/i.test(m.descricao);

export interface MesReserva {
  mes: string;
  /** Saldo no fim do mês (no mês atual, o de hoje). null = sem dado. */
  saldo: number | null;
  guardou: number;
  tirou: number;
  rendeu: number;
}

export interface Reserva {
  saldo: number | null;
  /** Diferença para o fim do mês anterior. */
  variacaoMes: number | null;
  rendeuMes: number;
  rendeu12: number;
  /** Último rendimento lançado (o do dia), para dar ideia de quanto rende por dia hoje. */
  ultimoRendimento: Movimentacao | null;
  meses: MesReserva[];
}

/**
 * Como a reserva (contas marcadas como Reserva) está crescendo nos últimos 12 meses: saldo no fim
 * de cada mês e, em cada mês, quanto você guardou, quanto tirou e quanto rendeu. Rendimento é a
 * entrada com "Rendimentos" na descrição, como o Mercado Pago lança todo dia.
 */
export function resumoReserva(movs: Movimentacao[], saldos: SaldoMensal[], ids: Set<string>, mesAtual: string, saldoHoje: number | null): Reserva {
  const meses = Array.from({ length: 12 }, (_, i) => addMes(mesAtual, i - 11));
  const daReserva = movs.filter((m) => ids.has(m.conta_id ?? ""));
  const mesDe = (m: Movimentacao) => m.data.slice(0, 7);
  const saldoNoMes = (mes: string): number | null => {
    const l = saldos.filter((s) => ids.has(s.conta_id) && s.competencia === mes);
    return l.length ? r2(l.reduce((a, s) => a + s.saldo_final, 0)) : null;
  };
  const linhas: MesReserva[] = meses.map((mes) => {
    const l = daReserva.filter((m) => mesDe(m) === mes);
    const rendeu = r2(l.filter(ehRendimento).reduce((a, m) => a + m.valor, 0));
    const guardou = r2(l.filter((m) => m.valor > 0 && !ehRendimento(m)).reduce((a, m) => a + m.valor, 0));
    const tirou = r2(-l.filter((m) => m.valor < 0).reduce((a, m) => a + m.valor, 0));
    const saldo = mes === mesAtual && saldoHoje !== null ? saldoHoje : saldoNoMes(mes);
    return { mes, saldo, guardou, tirou, rendeu };
  });
  // Corta os meses do começo sem nenhum dado, para o gráfico não começar com um vazio.
  const primeiro = linhas.findIndex((l) => l.saldo !== null || l.guardou || l.tirou || l.rendeu);
  const uteis = primeiro < 0 ? [] : linhas.slice(primeiro);
  const atual = uteis[uteis.length - 1];
  const anterior = uteis[uteis.length - 2];
  const rendimentos = daReserva.filter(ehRendimento).sort((a, b) => b.data.localeCompare(a.data));
  return {
    saldo: atual?.saldo ?? saldoHoje,
    variacaoMes: atual?.saldo != null && anterior?.saldo != null ? r2(atual.saldo - anterior.saldo) : null,
    rendeuMes: atual?.mes === mesAtual ? atual.rendeu : 0,
    rendeu12: r2(uteis.reduce((a, l) => a + l.rendeu, 0)),
    ultimoRendimento: rendimentos[0] ?? null,
    meses: uteis,
  };
}
