import type { Fixa, FormaPagamento, Movimentacao } from "./api";
import { addMes } from "./formato";
import { compDe, lugar } from "./gastos";

export const FORMAS: [FormaPagamento, string][] = [
  ["pix", "Pix"],
  ["cartao", "Cartão de crédito"],
  ["debito", "Débito automático"],
  ["boleto", "Boleto"],
  ["dinheiro", "Dinheiro"],
  ["outro", "Outro"],
];
/** Categoria de uma conta fixa: a escolhida, senão o padrão (Outros gastos depois de migrar, Assinaturas antes). A tela mostra e grava este mesmo valor. */
export const categoriaDaFixa = (escolhida: string | null | undefined, migrado: boolean) => escolhida || (migrado ? "outros" : "assinaturas");

export const nomeForma = (f: string) => FORMAS.find(([k]) => k === f)?.[1] ?? f;

const r2 = (v: number) => Math.round(v * 100) / 100;
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

/** O lançamento do banco que paga esta conta no mês (pelo texto de busca), se houver. */
export function pagamentoNoBanco(f: Fixa, movs: Movimentacao[], mes: string): Movimentacao | null {
  const b = f.busca ? norm(f.busca) : "";
  if (!b) return null;
  return movs.find((m) => m.valor < 0 && compDe(m) === mes && (norm(m.descricao).includes(b) || norm(m.nome ?? "").includes(b))) ?? null;
}

/** Cobrança no banco depois que você marcou como cancelada (o cancelamento pode não ter funcionado). */
export function cobradaDepois(f: Fixa, movs: Movimentacao[]): Movimentacao | null {
  const b = f.busca ? norm(f.busca) : "";
  if (f.ativa || !b || !f.cancelada_em) return null;
  return movs.filter((m) => m.valor < 0 && m.data > f.cancelada_em! && (norm(m.descricao).includes(b) || norm(m.nome ?? "").includes(b))).sort((a, c) => c.data.localeCompare(a.data))[0] ?? null;
}

export type Situacao = { tipo: "paga"; como: "banco" | "manual"; mov: Movimentacao | null } | { tipo: "atrasada" } | { tipo: "a_vencer" } | { tipo: "pausada" };

/** Paga (achada no banco ou marcada por você), atrasada (o dia já passou) ou a vencer. */
export function situacao(f: Fixa, movs: Movimentacao[], mes: string, diaHoje: number): Situacao {
  if (!f.ativa) return { tipo: "pausada" };
  if (f.pagos?.includes(mes)) return { tipo: "paga", como: "manual", mov: null };
  const mov = pagamentoNoBanco(f, movs, mes);
  if (mov) return { tipo: "paga", como: "banco", mov };
  return f.dia && f.dia < diaHoje ? { tipo: "atrasada" } : { tipo: "a_vencer" };
}

export interface Resumo {
  total: number;
  pago: number;
  falta: number;
  qtd: number;
  atrasadas: number;
}

export function resumo(fixas: Fixa[], movs: Movimentacao[], mes: string, diaHoje: number): Resumo {
  const ativas = fixas.filter((f) => f.ativa);
  let pago = 0;
  let atrasadas = 0;
  for (const f of ativas) {
    const s = situacao(f, movs, mes, diaHoje);
    if (s.tipo === "paga") pago += f.valor;
    if (s.tipo === "atrasada") atrasadas++;
  }
  const total = r2(ativas.reduce((a, f) => a + f.valor, 0));
  return { total, pago: r2(pago), falta: r2(Math.max(0, total - pago)), qtd: ativas.length, atrasadas };
}

/** "DL GOOGLE YOUTUB" → "Youtub"; "EBN SPOTIFY" → "Spotify": tira os prefixos de intermediadores de pagamento. */
export function nomeLimpo(chave: string): string {
  const t = chave.replace(/^((DL|DM|EBN|PG|PAG|PAGSEGURO|MP|MERCADOPAGO|PAYPAL|IFD|IFOOD|EC|HTM|APPLE COM BILL)\s+)+(GOOGLE\s+(?=\S))?/, "").trim() || chave;
  return t.charAt(0) + t.slice(1).toLowerCase();
}

export interface Sugestao {
  chave: string;
  /** Data da última cobrança ("2026-11-07"). */
  ultima: string;
  nome: string;
  valor: number;
  dia: number;
  forma: FormaPagamento;
  meses: number;
  categoria: string | null;
}

/**
 * Cobranças do banco que parecem contas fixas e ainda não estão cadastradas: tudo da categoria
 * Assinaturas, ou o mesmo lugar cobrado em pelo menos 3 dos últimos 4 meses com valor parecido
 * (até 10% de diferença), o que separa a assinatura da compra no mercado.
 * Fica de fora o que parou de ser cobrado (nada no mês atual nem no anterior: provavelmente
 * cancelada) e o que você mandou ignorar.
 */
export function sugestoes(movs: Movimentacao[], fixas: Fixa[], mesAtual: string, tipoConta: Map<string, string>, ignoradas: string[] = [], categorias: { id: string; nome: string }[] = []): Sugestao[] {
  const idsAssinaturas = new Set(categorias.filter((g) => norm(g.nome) === "ASSINATURAS").map((g) => g.id));
  const recentes = new Set([mesAtual, addMes(mesAtual, -1)]);
  const fora = new Set(ignoradas);
  const janela = new Set([0, 1, 2, 3].map((i) => addMes(mesAtual, -i)));
  const grupos = new Map<string, Movimentacao[]>();
  for (const m of movs) {
    if (m.valor >= 0 || m.natureza !== "despesa" || !janela.has(compDe(m)) || m.parcela) continue;
    const k = lugar(m.descricao);
    grupos.set(k, [...(grupos.get(k) ?? []), m]);
  }
  const buscas = fixas.map((f) => norm(f.busca ?? "")).filter(Boolean);
  const out: Sugestao[] = [];
  for (const [k, l] of grupos) {
    if (fora.has(k) || buscas.some((b) => norm(k).includes(b) || b.includes(norm(k)))) continue;
    if (!l.some((m) => recentes.has(compDe(m)))) continue;
    const meses = new Set(l.map(compDe)).size;
    const valores = l.map((m) => -m.valor);
    const max = Math.max(...valores);
    const min = Math.min(...valores);
    const assinatura = l.some((m) => m.categoria === "assinaturas" || idsAssinaturas.has(m.categoria ?? "") || m.recorrencia === "fixa");
    const repetida = meses >= 3 && l.length <= meses + 1 && min >= max * 0.9;
    if (!assinatura && !repetida) continue;
    const ultimo = [...l].sort((a, b) => b.data.localeCompare(a.data))[0];
    out.push({
      chave: k,
      ultima: ultimo.data,
      nome: nomeLimpo(k),
      valor: r2(-ultimo.valor),
      dia: Number(ultimo.data.slice(8, 10)) || 1,
      forma: tipoConta.get(ultimo.conta_id ?? "") === "cartao" ? "cartao" : /\bPIX\b/.test(k) ? "pix" : "debito",
      meses,
      categoria: ultimo.categoria && ultimo.categoria !== "a_classificar" ? ultimo.categoria : null,
    });
  }
  return out.sort((a, b) => b.meses - a.meses || b.valor - a.valor);
}
