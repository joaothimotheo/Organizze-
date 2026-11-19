/** Regras do que conta como gasto, entrada ou "não conta no mês". Uma fonte só para o front inteiro. */
export type { Grupo } from "./api";

type ComNatureza = { natureza: string };
type ComCategoria = ComNatureza & { categoria?: string | null };

/** Gasto: só a despesa. Estorno não abate gasto, vira entrada. */
export const ehGasto = (m: ComNatureza) => m.natureza === "despesa";

/** Entrada: receita ou estorno. */
export const ehEntrada = (m: ComNatureza) => m.natureza === "receita" || m.natureza === "estorno";

/** Não conta no mês: transferência entre contas, aporte, dívida paga, empréstimos e resgates. */
export const naoConta = (m: ComNatureza) => !ehGasto(m) && !ehEntrada(m);

/** Gasto ou entrada que ainda espera um grupo. */
export const semCategoria = (m: ComCategoria) => (ehGasto(m) || ehEntrada(m)) && (!m.categoria || m.categoria === "a_classificar");

const centavos = (v: number) => Math.round(Math.abs(v) * 100);

/**
 * Pedaços de um lançamento por categoria: as partes, se somam o valor (no centavo); senão
 * (ou sem partes) o lançamento inteiro na sua categoria.
 */
export function partesDe(m: { valor: number; categoria?: string | null; partes?: { valor: number; categoria: string }[] | null }): { valor: number; categoria: string }[] {
  const p = m.partes;
  if (p && p.length && p.reduce((s, x) => s + centavos(x.valor), 0) === centavos(m.valor)) return p.map((x) => ({ valor: x.valor, categoria: x.categoria || "a_classificar" }));
  return [{ valor: m.valor, categoria: m.categoria || "a_classificar" }];
}

/** O que não conta no mês: [natureza, nome, texto curto]. */
export const NATUREZAS_NAO_CONTA: { saida: [string, string, string][]; entrada: [string, string, string][] } = {
  saida: [
    ["transferencia_interna", "Entre minhas contas", "Passei de um banco para outro"],
    ["aporte_investimento", "Guardei ou investi", "Foi para a reserva ou investimento"],
    ["pagamento_divida", "Paguei uma dívida", "Parcela de empréstimo ou acordo"],
    ["emprestimo_concedido", "Emprestei para alguém", "Aparece em Pessoas"],
  ],
  entrada: [
    ["transferencia_interna", "Entre minhas contas", "Veio de outro banco meu"],
    ["emprestimo_devolvido", "Me devolveram", "Pagaram o que eu emprestei"],
    ["emprestimo_recebido", "Peguei emprestado", "Vira uma dívida"],
    ["resgate_investimento", "Tirei da reserva", "Saiu da reserva ou do investimento"],
  ],
};

/** Nome de uma natureza que não conta no mês ("Guardei ou investi"); outra natureza volta como veio. */
export function nomeNatureza(natureza: string): string {
  return [...NATUREZAS_NAO_CONTA.saida, ...NATUREZAS_NAO_CONTA.entrada].find(([n]) => n === natureza)?.[1] ?? natureza;
}

/**
 * Depois de migrar, um lançamento que não conta no mês não tem grupo para escolher (o servidor
 * recusa): mostra só o nome da natureza. Sem migrar, ou sem natureza, a lista aparece como antes.
 */
export const soNatureza = (migrado: boolean, natureza: string | null | undefined) => migrado && !!natureza && naoConta({ natureza });

export type TipoGrupo = "gasto" | "entrada";

/** Tipo de grupo que combina com a natureza do lançamento; transferência e afins não têm. */
export function tipoDaNatureza(natureza: string | null | undefined): TipoGrupo | undefined {
  const m = { natureza: natureza ?? "" };
  return ehGasto(m) ? "gasto" : ehEntrada(m) ? "entrada" : undefined;
}

/** As oito cores de grupo (tokens `--g1`..`--g8` do estilo). */
export const CORES_GRUPO = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8"];

/** Primeira cor ainda sem uso entre `usadas`; se todas já têm, segue a contagem. */
export function proximaCor(usadas: string[]): string {
  return CORES_GRUPO.find((c) => !usadas.includes(c)) ?? CORES_GRUPO[usadas.length % CORES_GRUPO.length];
}

/** "Combustível, Manutenção ,, IPVA" → ["Combustível", "Manutenção", "IPVA"] */
export function lerDetalhes(texto: string): string[] {
  return texto
    .split(",")
    .map((d) => d.split(/\s+/).filter(Boolean).join(" "))
    .filter(Boolean);
}

/**
 * Quantos lançamentos há em cada grupo, contando o dividido uma vez em cada grupo das partes (como
 * o servidor ao apagar um grupo).
 */
export function lancamentosPorGrupo(movs: { categoria?: string | null; partes?: { categoria: string }[] | null }[]): Map<string, number> {
  const r = new Map<string, number>();
  for (const m of movs) {
    const cats = new Set<string>();
    if (m.categoria) cats.add(m.categoria);
    for (const p of m.partes ?? []) if (p.categoria) cats.add(p.categoria);
    for (const c of cats) r.set(c, (r.get(c) ?? 0) + 1);
  }
  return r;
}

type ComValor = ComCategoria & { valor: number; data: string; competencia?: string | null; partes?: { valor: number; categoria: string }[] | null };

/**
 * Quantas vezes e quanto (em valor absoluto) cada categoria foi usada no período: o mês
 * escolhido (`mes` de 1 a 12) ou o ano inteiro (`mes` nulo), pela competência do lançamento.
 */
export function usoNoPeriodo(movs: ComValor[], ano: number, mes: number | null): Map<string, { vezes: number; valor: number }> {
  const alvo = mes === null ? `${ano}-` : `${ano}-${String(mes).padStart(2, "0")}`;
  const r = new Map<string, { vezes: number; valor: number }>();
  for (const m of movs) {
    if (!m.categoria) continue;
    const comp = m.competencia ?? m.data.slice(0, 7);
    if (!comp.startsWith(alvo)) continue;
    for (const p of partesDe(m)) {
      const u = r.get(p.categoria) ?? { vezes: 0, valor: 0 };
      u.vezes++;
      u.valor += Math.abs(p.valor);
      r.set(p.categoria, u);
    }
  }
  return r;
}
