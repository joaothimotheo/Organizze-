import type { Brutos } from "./api";
import { porPessoa } from "./emprestimos";
import { addMes, hojeISO } from "./formato";

/** "Vou receber um dinheiro": separa o que já tem destino e sugere onde usar o resto. */

const r2 = (v: number) => Math.round(v * 100) / 100;
/** Meses de `a` até `b` ("2026-12" → "2027-02" = 2). */
const difMes = (a: string, b: string) => {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

/** Dívida "cara": a partir disso, adiantar vale mais que guardar na reserva. */
export const TAXA_CARA = 0.01;

/**
 * Juros ao mês (fração) de um parcelamento com parcelas fixas: o `i` em que
 * parcela = valorOriginal × i / (1 − (1 + i)^−parcelas). Sem juros (parcelas somam o original ou menos): 0.
 */
export function taxaImplicita(valorOriginal: number, parcelas: number, parcela: number): number {
  if (!(valorOriginal > 0 && parcelas > 0 && parcela > 0) || parcela * parcelas <= valorOriginal * 1.0005) return 0;
  const pmt = (i: number) => (valorOriginal * i) / (1 - Math.pow(1 + i, -parcelas));
  let lo = 1e-7;
  let hi = 1;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (pmt(mid) < parcela) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface Candidata {
  id: string;
  nome: string;
  tipo: "atrasada" | "juros" | "sem_juros" | "desconhecida";
  /** Fração ao mês; null = não dá para saber. */
  taxa: number | null;
  parcela: number;
  /** Parcelas que vencem depois do mês em que o dinheiro entra. 1 com parcela = saldo: dívida sem parcelas. */
  restantes: number;
  primeiroMes: string;
  saldo: number;
  aviso?: string;
}

/** O que dá para pagar ou adiantar com o dinheiro que entra em `mesRecebe`. A fatura do cartão nunca entra. */
export function candidatas(brutos: Brutos, mesRecebe: string, cartao: { nome: string; valor: number; meses: string[] }[] = []): Candidata[] {
  const hoje = hojeISO();
  const out: Candidata[] = [];
  for (const d of brutos.dividas) {
    if (d.origem?.tipo !== "informado" || d.situacao === "quitada" || d.tipo === "cartao_de_credito") continue;
    const nome = d.nome ?? d.credor;
    const saldo = [...(d.saldos ?? [])].sort((a, b) => a.data.localeCompare(b.data)).pop()?.saldo_devedor ?? 0;
    const r = d.parcelas_restantes ?? 0;
    const p = d.parcela_valor ?? 0;
    if (!(r > 0 && p > 0)) {
      if (saldo <= 0.004) continue;
      const atrasada = (!!d.vencimento_original && d.vencimento_original <= hoje) || d.tipo === "ipva";
      out.push({ id: d.id, nome, tipo: atrasada ? "atrasada" : "desconhecida", taxa: null, parcela: r2(saldo), restantes: 1, primeiroMes: mesRecebe, saldo: r2(saldo) });
      continue;
    }
    // Parcelas que vencem até o mês do dinheiro são pagas normalmente; só as seguintes podem ser adiantadas.
    const inicio = d.proximo_vencimento ? d.proximo_vencimento.slice(0, 7) : addMes(hojeISO().slice(0, 7), 1);
    const primeiro = inicio > mesRecebe ? inicio : addMes(mesRecebe, 1);
    const restantes = r - Math.max(0, difMes(inicio, primeiro));
    if (restantes <= 0) continue;
    const taxa =
      d.taxa_mensal != null ? d.taxa_mensal / 100 : d.valor_contratado && d.parcelas_total && d.parcelas_total >= r ? taxaImplicita(d.valor_contratado, d.parcelas_total, p) : null;
    out.push({
      id: d.id,
      nome,
      tipo: taxa === null ? "desconhecida" : taxa >= TAXA_CARA ? "juros" : "sem_juros",
      taxa,
      parcela: p,
      restantes,
      primeiroMes: primeiro,
      saldo: r2(restantes * p),
      aviso: taxa === null ? "Não sei os juros desta dívida: cadastre o valor original e o total de parcelas para eu calcular." : undefined,
    });
  }
  for (const c of cartao) {
    const meses = c.meses.filter((m) => m > mesRecebe).sort();
    if (!meses.length) continue;
    out.push({
      id: `cartao-${c.nome}`,
      nome: c.nome,
      tipo: "sem_juros",
      taxa: 0,
      parcela: c.valor,
      restantes: meses.length,
      primeiroMes: meses[0],
      saldo: r2(meses.length * c.valor),
      aviso: "Compra parcelada no cartão: dá para antecipar pelo app do banco.",
    });
  }
  for (const p of porPessoa(brutos.emprestimos, "eu_devo")) {
    if (p.total <= 0.004) continue;
    out.push({ id: `pessoa-${p.nome}`, nome: p.nome, tipo: "sem_juros", taxa: 0, parcela: r2(p.total), restantes: 1, primeiroMes: mesRecebe, saldo: r2(p.total), aviso: "Dinheiro que você deve a uma pessoa." });
  }
  return out;
}

export interface Passo {
  tipo: "separado" | "atrasada" | "juros" | "reserva" | "desconhecida" | "sem_juros" | "sobra";
  nome: string;
  valor: number;
  /** Parcelas adiantadas (das últimas para as primeiras). */
  parcelas?: number;
  /** Juros que deixa de pagar adiantando. */
  economia?: number;
  /** Paga a dívida toda. */
  quita?: boolean;
  /** Mês da última parcela depois de adiantar (null = quitada). */
  terminaEm?: string | null;
  /** Mês da última parcela sem adiantar. */
  terminavaEm?: string | null;
  taxa?: number | null;
  aviso?: string;
}

export interface Entrada {
  valor: number;
  /** Mês em que o dinheiro entra ("2026-12"). */
  mes: string;
  separacoes: { nome: string; valor: number }[];
  candidatas: Candidata[];
  /** Quanto falta para a meta da reserva. */
  faltaReserva: number;
}

/**
 * Ordem: o que já tem destino → atrasadas → dívidas com juros ≥ 1% (maior taxa primeiro) → reserva até a meta →
 * juros desconhecidos → sem juros → sobra na reserva. Parcelas são adiantadas inteiras, da última para a
 * primeira, pelo valor presente na taxa da dívida.
 */
export function planejar(e: Entrada): { passos: Passo[]; excedeu: number; economia: number } {
  const passos: Passo[] = [];
  const separado = r2(e.separacoes.reduce((a, s) => a + Math.max(0, s.valor), 0));
  for (const s of e.separacoes) if (s.valor > 0) passos.push({ tipo: "separado", nome: s.nome || "Sem nome", valor: r2(s.valor) });
  if (separado > e.valor + 0.004) return { passos, excedeu: r2(separado - e.valor), economia: 0 };
  let resto = r2(e.valor - separado);

  const pagar = (c: Candidata, tipo: Passo["tipo"]) => {
    if (resto <= 0.004) return;
    const i = c.taxa ?? 0;
    const terminavaEm = addMes(c.primeiroMes, c.restantes - 1);
    if (c.restantes === 1 && c.parcela === c.saldo) {
      // Sem parcelas: dá para pagar uma parte.
      const v = r2(Math.min(resto, c.saldo));
      resto = r2(resto - v);
      passos.push({ tipo, nome: c.nome, valor: v, quita: v >= c.saldo - 0.004, taxa: c.taxa, aviso: c.aviso });
      return;
    }
    let n = 0;
    let custo = 0;
    let economia = 0;
    for (let k = c.restantes - 1; k >= 0; k--) {
      const t = Math.max(1, difMes(e.mes, addMes(c.primeiroMes, k)));
      const v = c.parcela / Math.pow(1 + i, t);
      if (custo + v > resto + 0.004) break;
      custo += v;
      economia += c.parcela - v;
      n++;
    }
    if (!n) return;
    custo = r2(custo);
    resto = r2(resto - custo);
    passos.push({
      tipo,
      nome: c.nome,
      valor: custo,
      parcelas: n,
      economia: r2(economia),
      quita: n === c.restantes,
      terminaEm: n === c.restantes ? null : addMes(c.primeiroMes, c.restantes - 1 - n),
      terminavaEm,
      taxa: c.taxa,
      aviso: c.aviso,
    });
  };

  for (const c of e.candidatas.filter((c) => c.tipo === "atrasada")) pagar(c, "atrasada");
  for (const c of e.candidatas.filter((c) => c.tipo === "juros").sort((a, b) => (b.taxa ?? 0) - (a.taxa ?? 0))) pagar(c, "juros");
  if (resto > 0.004 && e.faltaReserva > 0.004) {
    const v = r2(Math.min(resto, e.faltaReserva));
    resto = r2(resto - v);
    passos.push({ tipo: "reserva", nome: "Reserva de emergência", valor: v });
  }
  for (const c of e.candidatas.filter((c) => c.tipo === "desconhecida")) pagar(c, "desconhecida");
  for (const c of e.candidatas.filter((c) => c.tipo === "sem_juros").sort((a, b) => a.saldo - b.saldo)) pagar(c, "sem_juros");
  if (resto > 0.004) passos.push({ tipo: "sobra", nome: "Guardar na reserva", valor: resto });
  return { passos, excedeu: 0, economia: r2(passos.reduce((a, p) => a + (p.economia ?? 0), 0)) };
}
