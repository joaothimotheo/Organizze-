import { addMes } from "./formato";

/** Dívida que já tem parcelas marcadas (cartão, empréstimo, parcelamento): termina sozinha. */
export interface Parcelada {
  nome: string;
  valor: number;
  /** Meses de vencimento ("2026-12"), um por parcela. */
  meses: string[];
}

/** Dívida sem parcelas (IPVA atrasado, dinheiro devido a uma pessoa): sai do que sobra por mês. */
export interface AVista {
  nome: string;
  valor: number;
}

export interface Evento {
  mes: string;
  nome: string;
  tipo: "parcelada" | "avista" | "meta";
}

export interface Plano {
  eventos: Evento[];
  /** Mês em que a última dívida termina (null = não termina em 10 anos com esse valor por mês). */
  livre: string | null;
  /** Mês em que a primeira meta é alcançada (null = sem meta ou não alcança em 10 anos). */
  meta: string | null;
  /** Mês em que cada meta é alcançada, na ordem recebida (null = não alcança em 10 anos). */
  metas: (string | null)[];
  totalParcelado: number;
  totalAVista: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Simula mês a mês, a partir de `inicio` (o mês seguinte ao atual):
 * - as parcelas continuam sendo pagas como hoje e cada uma termina no seu último mês;
 * - `porMes` é o que você consegue separar além das parcelas; quando uma dívida parcelada
 *   termina, o valor da parcela dela passa a somar no que dá para separar ("bola de neve");
 * - esse dinheiro quita primeiro as dívidas sem parcelas, na ordem recebida, e depois vai
 *   para as metas, uma de cada vez, na ordem recebida.
 */
export function simular(parceladas: Parcelada[], avista: AVista[], metasOuMeta: { nome: string; falta: number }[] | { nome: string; falta: number } | null, porMes: number, inicio: string): Plano {
  const listaMetas = metasOuMeta === null ? [] : Array.isArray(metasOuMeta) ? metasOuMeta : [metasOuMeta];
  const eventos: Evento[] = [];
  const parcelaNoMes = (m: string) => parceladas.reduce((a, p) => a + (p.meses.includes(m) ? p.valor : 0), 0);
  const base = parcelaNoMes(inicio);
  for (const p of parceladas) {
    const ultimo = [...p.meses].sort().pop();
    if (ultimo) eventos.push({ mes: ultimo, nome: p.nome, tipo: "parcelada" });
  }
  const fila = avista.filter((a) => a.valor > 0.004).map((a) => ({ ...a, falta: a.valor }));
  const faltas = listaMetas.map((m) => (m.falta > 0.004 ? m.falta : 0));
  const mesMetas: (string | null)[] = faltas.map((f) => (f === 0 ? inicio : null));
  const metaAberta = () => faltas.findIndex((f) => f > 0);
  let ultimoAVista: string | null = fila.length ? null : inicio;
  let mes = inicio;
  for (let i = 0; i < 120 && (fila.length || metaAberta() >= 0); i++, mes = addMes(mes, 1)) {
    let caixa = Math.max(0, porMes) + Math.max(0, base - parcelaNoMes(mes));
    while (caixa > 0.004 && fila.length) {
      const d = fila[0];
      const pago = Math.min(caixa, d.falta);
      d.falta = r2(d.falta - pago);
      caixa = r2(caixa - pago);
      if (d.falta <= 0.004) {
        eventos.push({ mes, nome: d.nome, tipo: "avista" });
        fila.shift();
        if (!fila.length) ultimoAVista = mes;
      }
    }
    // O que sobra no mês passa para a próxima meta.
    for (let j = metaAberta(); !fila.length && j >= 0 && caixa > 0.004; j = metaAberta()) {
      const pago = Math.min(caixa, faltas[j]);
      faltas[j] = r2(faltas[j] - pago);
      caixa = r2(caixa - pago);
      if (faltas[j] <= 0.004) {
        faltas[j] = 0;
        mesMetas[j] = mes;
        eventos.push({ mes, nome: listaMetas[j].nome, tipo: "meta" });
      }
    }
  }
  const fimParcelas = parceladas.flatMap((p) => p.meses).sort().pop() ?? null;
  const livre = fila.length ? null : [fimParcelas, ultimoAVista].filter((x): x is string => !!x).sort().pop() ?? inicio;
  eventos.sort((a, b) => a.mes.localeCompare(b.mes) || (a.tipo === "meta" ? 1 : 0) - (b.tipo === "meta" ? 1 : 0));
  return {
    eventos,
    livre,
    meta: listaMetas.length ? mesMetas[0] : null,
    metas: mesMetas,
    totalParcelado: r2(parceladas.reduce((a, p) => a + p.valor * p.meses.length, 0)),
    totalAVista: r2(avista.reduce((a, d) => a + d.valor, 0)),
  };
}

/** Saldo somado das contas marcadas como reserva, pela última sincronização (null = sem dado). */
export function saldoReserva(contas: { conta_id?: string; tipo?: string; saldo?: number | null }[] | undefined, reservas: Set<string>): number | null {
  const l = (contas ?? []).filter((c) => c.tipo === "corrente" && c.saldo != null && !!c.conta_id && reservas.has(c.conta_id));
  return l.length ? r2(l.reduce((a, c) => a + (c.saldo ?? 0), 0)) : null;
}

/** Quanto já está guardado na meta: o saldo da reserva, se ela acompanha a reserva; senão, o valor anotado. */
export const guardadoNaMeta = (m: { saldo_reservado: number; usar_reserva?: boolean }, reserva: number | null) =>
  m.usar_reserva && reserva !== null ? reserva : m.saldo_reservado;

/** Quanto guardar por mês para juntar `falta` até o mês `prazo` ("2027-06"), contando a partir de `inicio`. */
export function porMesAte(falta: number, inicio: string, prazo: string): number | null {
  const [ya, ma] = inicio.split("-").map(Number);
  const [yb, mb] = prazo.split("-").map(Number);
  const meses = (yb - ya) * 12 + (mb - ma) + 1;
  if (meses < 1) return null;
  return Math.ceil((Math.max(0, falta) / meses) * 100) / 100;
}
