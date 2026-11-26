/**
 * Previsão do saldo da conta, dia a dia, e quanto dá para gastar por dia até o próximo salário.
 *
 * Parte do saldo de hoje das contas correntes (sem a reserva) e soma o que já se sabe que vai
 * entrar e sair da conta: salário previsto, faturas do cartão, contas fixas pagas fora do cartão
 * e parcelas das dívidas cadastradas. O "pode gastar por dia" usa só isso; a série do gráfico
 * desconta também o gasto médio por dia da conta (o dia a dia).
 */
import type { Brutos, Movimentacao } from "./api";
import { fixaPaga } from "./analises";
import { juntarDividas } from "./dividas";
import { addMes } from "./formato";
import { ehEntrada, ehGasto, partesDe } from "./grupos";

export interface EventoPrevisto {
  dia: string;
  nome: string;
  /** Positivo entra, negativo sai. */
  valor: number;
  tipo: "salario" | "fatura" | "fixa" | "parcela";
}

export interface SalarioPrevisto {
  dia: string;
  valor: number;
  /** "holerite": data e líquido do holerite; "historico": pelos últimos salários na conta. */
  pelo: "holerite" | "historico";
}

export interface Previsao {
  saldoHoje: number;
  salario: SalarioPrevisto | null;
  /** Último dia do "pode gastar por dia": o dia do salário (ou da fatura logo depois dele); sem salário, o fim do mês. */
  ate: string;
  /** Dias de hoje até `ate`, contando os dois. */
  dias: number;
  porDia: number;
  /** O dia que limita o `porDia` e o saldo nele, sem gastar nada no dia a dia. */
  aperto: { dia: string; saldo: number } | null;
  /** Mesmo sem gastar nada no dia a dia, o saldo fica negativo até `ate`: o primeiro dia e quanto falta. */
  falta: { dia: string; valor: number } | null;
  /** Gasto médio por dia da conta nos últimos 60 dias (sem parcelas, contas fixas nem reserva). */
  diaADia: number;
  eventos: EventoPrevisto[];
  /** Saldo no fim de cada dia, de hoje até o horizonte, com o dia a dia descontado. */
  serie: { dia: string; saldo: number }[];
  /** Primeiro dia da série com saldo negativo. */
  negativo: string | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const diasNoMes = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
const diaNoMes = (mes: string, dia: number) => `${mes}-${String(Math.min(dia, diasNoMes(mes))).padStart(2, "0")}`;
const utc = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);

export function addDias(iso: string, n: number): string {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dias de `a` até `b` (b − a). */
const entre = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);

/** Sábado e domingo andam para a segunda-feira. */
function diaUtil(iso: string): string {
  const s = utc(iso).getUTCDay();
  return s === 6 ? addDias(iso, 2) : s === 0 ? addDias(iso, 1) : iso;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Contas correntes do dia a dia (sem as marcadas como reserva). */
function correntes(b: Brutos): Set<string> {
  return new Set(b.contas.filter((c) => c.tipo === "corrente" && c.papel !== "reserva").map((c) => c.id));
}

function ehSalario(m: Movimentacao, nomes: Map<string, string>): boolean {
  return partesDe(m).some((p) => p.categoria === "salario" || semAcento(nomes.get(p.categoria) ?? "") === "salario");
}

/**
 * Próximo salário: o holerite com pagamento depois de hoje, se houver; senão pelos salários que
 * caíram na conta (o maior de cada mês, os 3 meses mais recentes): valor = mediana, dia = o do
 * último, no mês seguinte (fim de semana vai para a segunda). Sem salário nos últimos 75 dias, null.
 */
export function salarioPrevisto(b: Brutos, hoje: string): SalarioPrevisto | null {
  const hol = b.holerites
    .filter((h) => h.data_pagamento && h.data_pagamento.slice(0, 10) > hoje && (h.liquido_competencia ?? h.liquido) > 0)
    .sort((x, y) => x.data_pagamento!.localeCompare(y.data_pagamento!))[0];
  if (hol) return { dia: hol.data_pagamento!.slice(0, 10), valor: r2(hol.liquido_competencia ?? hol.liquido), pelo: "holerite" };

  const nomes = new Map(b.categorias.map((c) => [c.id, c.nome]));
  const contas = correntes(b);
  const porMes = new Map<string, Movimentacao>();
  for (const m of b.movimentacoes) {
    if (m.natureza !== "receita" || !ehEntrada(m) || !contas.has(m.conta_id ?? "") || m.data.slice(0, 10) > hoje || !ehSalario(m, nomes)) continue;
    const mes = m.data.slice(0, 7);
    const atual = porMes.get(mes);
    if (!atual || m.valor > atual.valor) porMes.set(mes, m);
  }
  const ultimos = [...porMes.values()].sort((x, y) => y.data.localeCompare(x.data)).slice(0, 3);
  if (!ultimos.length || entre(ultimos[0].data, hoje) > 75) return null;
  const valores = ultimos.map((m) => m.valor).sort((x, y) => x - y);
  const valor = valores[Math.floor((valores.length - 1) / 2)];
  const dia = Number(ultimos[0].data.slice(8, 10));
  let proximo = diaUtil(diaNoMes(addMes(ultimos[0].data.slice(0, 7), 1), dia));
  for (let i = 2; proximo <= hoje && i < 14; i++) proximo = diaUtil(diaNoMes(addMes(ultimos[0].data.slice(0, 7), i), dia));
  return { dia: proximo, valor: r2(valor), pelo: "historico" };
}

/** Contas fixas pagas fora do cartão: as de cada mês até `fim`. Atrasadas do mês de hoje contam hoje. */
function eventosFixas(b: Brutos, hoje: string, fim: string): EventoPrevisto[] {
  const out: EventoPrevisto[] = [];
  const mesHoje = hoje.slice(0, 7);
  for (const f of b.fixas) {
    if (!f.ativa || f.forma === "cartao" || !(f.valor > 0)) continue;
    for (let mes = mesHoje; mes <= fim.slice(0, 7); mes = addMes(mes, 1)) {
      if (fixaPaga(f, b.movimentacoes, mes)) continue;
      let dia = diaNoMes(mes, f.dia || 31);
      if (dia < hoje) {
        if (mes !== mesHoje) continue;
        dia = hoje;
      }
      if (dia <= fim) out.push({ dia, nome: f.nome, valor: -r2(f.valor), tipo: "fixa" });
    }
  }
  return out;
}

/** Parcelas das dívidas cadastradas: a próxima (atrasada conta hoje) e as seguintes, uma por mês, até `fim`. */
function eventosParcelas(b: Brutos, hoje: string, fim: string): EventoPrevisto[] {
  const out: EventoPrevisto[] = [];
  for (const d of juntarDividas(b, hoje)) {
    if (d.origem !== "cadastrada" || !d.proxima || !(d.proxima.valor > 0)) continue;
    const restantes = d.total !== null && d.pagas !== null ? d.total - d.pagas : 99;
    for (let i = 0; i < restantes; i++) {
      const base = d.proxima.data.slice(0, 10);
      let dia = i === 0 ? base : diaNoMes(addMes(base.slice(0, 7), i), Number(base.slice(8, 10)));
      if (dia < hoje) {
        if (i > 0) continue;
        dia = hoje;
      }
      if (dia > fim) break;
      out.push({ dia, nome: d.nome, valor: -r2(d.proxima.valor), tipo: "parcela" });
    }
  }
  return out;
}

/** Gasto médio por dia das contas correntes nos 60 dias até hoje, sem parcelas e contas fixas. */
function gastoMedioPorDia(b: Brutos, hoje: string): number {
  const contas = correntes(b);
  const de = addDias(hoje, -59);
  const total = b.movimentacoes
    .filter(
      (m) =>
        ehGasto(m) &&
        contas.has(m.conta_id ?? "") &&
        m.data.slice(0, 10) >= de &&
        m.data.slice(0, 10) <= hoje &&
        !m.parcela &&
        m.vinculo?.tipo !== "fixa" &&
        m.vinculo?.tipo !== "divida" &&
        m.recorrencia !== "fixa",
    )
    .reduce((s, m) => s - m.valor, 0);
  return r2(total / 60);
}

const ORDEM: Record<EventoPrevisto["tipo"], number> = { salario: 0, fatura: 1, parcela: 2, fixa: 3 };

/**
 * `saldo`: o de hoje nas contas correntes (sem reserva). `faturas`: o que vai sair da conta para
 * pagar o cartão (dia do vencimento e valor). `horizonte`: dias do gráfico depois de hoje.
 */
export function previsao(b: Brutos, entrada: { saldo: number; faturas: { dia: string; valor: number; nome: string }[] }, hoje: string, horizonte = 35): Previsao {
  const salario = salarioPrevisto(b, hoje);
  let ate = salario?.dia ?? diaNoMes(hoje.slice(0, 7), 31);
  // Fatura que vence logo depois do salário (até 15 dias) é paga com ele: entra no período.
  for (const f of entrada.faturas) if (salario && f.dia > ate && entre(salario.dia, f.dia) <= 15) ate = f.dia;
  const fim = [addDias(hoje, horizonte), ate].sort()[1];

  const eventos: EventoPrevisto[] = [
    ...(salario && salario.dia <= fim ? [{ dia: salario.dia, nome: "Salário", valor: salario.valor, tipo: "salario" as const }] : []),
    ...entrada.faturas.filter((f) => f.valor > 0.004).map((f) => ({ dia: f.dia < hoje ? hoje : f.dia, nome: f.nome, valor: -r2(f.valor), tipo: "fatura" as const })),
    ...eventosFixas(b, hoje, fim),
    ...eventosParcelas(b, hoje, fim),
  ]
    .filter((e) => e.dia <= fim)
    .sort((x, y) => x.dia.localeCompare(y.dia) || ORDEM[x.tipo] - ORDEM[y.tipo] || x.nome.localeCompare(y.nome, "pt-BR"));

  // Saldo no fim de cada dia só com os eventos (sem o dia a dia).
  const total = entre(hoje, fim);
  const base: number[] = [];
  let acumulado = entrada.saldo;
  let j = 0;
  for (let i = 0; i <= total; i++) {
    const dia = addDias(hoje, i);
    while (j < eventos.length && eventos[j].dia <= dia) acumulado += eventos[j++].valor;
    base.push(r2(acumulado));
  }

  const dias = entre(hoje, ate) + 1;
  let porDia = Infinity;
  let aperto: Previsao["aperto"] = null;
  let falta: Previsao["falta"] = null;
  for (let i = 0; i < dias; i++) {
    if (base[i] < 0 && !falta) falta = { dia: addDias(hoje, i), valor: r2(-base[i]) };
    const v = base[i] / (i + 1);
    if (v < porDia) {
      porDia = v;
      aperto = { dia: addDias(hoje, i), saldo: base[i] };
    }
  }

  const diaADia = gastoMedioPorDia(b, hoje);
  const serie = base.map((v, i) => ({ dia: addDias(hoje, i), saldo: r2(v - diaADia * (i + 1)) }));
  return {
    saldoHoje: r2(entrada.saldo),
    salario,
    ate,
    dias,
    porDia: falta ? 0 : r2(Math.max(0, Math.floor(porDia * 100) / 100)),
    aperto: falta ? null : aperto,
    falta,
    diaADia,
    eventos,
    serie,
    negativo: serie.find((p) => p.saldo < -0.004)?.dia ?? null,
  };
}
