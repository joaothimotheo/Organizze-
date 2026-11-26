import type { Brutos } from "./api";
import { acimaDaMedia, dividasPagasNoMes, fixaPaga, totaisDoMes } from "./analises";
import { addMes } from "./formato";
import { compDe } from "./gastos";
import { idsReserva, resumoReserva } from "./reserva";

/** O resumo de um mês fechado, para a tela "Fechamento do mês" e para o PDF. */
export interface ResumoMes {
  mes: string;
  entrou: number;
  saiu: number;
  sobra: number;
  /** Até 3 grupos que mais cresceram contra o mês anterior (só os que subiram). */
  cresceram: { nome: string; valor: number; diferenca: number }[];
  /** Pagamentos de dívida do mês. */
  dividas: number;
  /** Entrou nas contas de reserva no mês (sem rendimentos). */
  guardado: number;
  fixas: { pagas: number; total: number; faltaram: { nome: string; valor: number }[] };
  /** Nenhum lançamento no mês. */
  vazio: boolean;
  /** O mês anterior não teve gasto algum (não há com o que comparar). */
  semGastoAnterior: boolean;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function resumoDoMes(b: Brutos, mes: string): ResumoMes {
  const movs = b.movimentacoes;
  const vazio = !movs.some((m) => compDe(m) === mes);
  const t = totaisDoMes(movs, mes, undefined, b.holerites);
  const cresceram = acimaDaMedia(movs, b.categorias, [addMes(mes, -1), mes])
    .map((x) => ({ nome: x.nome, valor: x.mes, diferenca: r2(x.mes - x.media) }))
    .filter((x) => x.diferenca > 0.004)
    .slice(0, 3);
  const reserva = resumoReserva(movs, b.saldosContas, idsReserva(b.contas), mes, null);
  const ativas = b.fixas.filter((f) => f.ativa);
  const faltaram = ativas.filter((f) => !fixaPaga(f, movs, mes)).map((f) => ({ nome: f.nome, valor: f.valor }));
  return {
    mes,
    entrou: t.entrou,
    saiu: t.saiu,
    sobra: t.sobra,
    cresceram,
    dividas: dividasPagasNoMes(movs, mes),
    guardado: reserva.meses.find((m) => m.mes === mes)?.guardou ?? 0,
    fixas: { pagas: ativas.length - faltaram.length, total: ativas.length, faltaram },
    vazio,
    semGastoAnterior: totaisDoMes(movs, addMes(mes, -1), undefined, b.holerites).saiu <= 0.004,
  };
}

/** Mês que a tela mostra: o do endereço se for um mês já terminado; senão, o mês anterior ao de hoje. */
export function mesDoFechamento(detalhe: string | null, hoje: string): string {
  const anterior = addMes(hoje.slice(0, 7), -1);
  if (detalhe && /^\d{4}-(0[1-9]|1[0-2])$/.test(detalhe) && detalhe < hoje.slice(0, 7)) return detalhe;
  return anterior;
}
