import { useMemo, useState } from "react";
import type { Brutos } from "../api";
import { candidatas, planejar, type Passo } from "../extra";
import { addMes, capitalizar, hojeISO, lerValor, MESES, numero, reais } from "../formato";
import { parcelasDoCartao } from "../dividas";
import { guardadoNaMeta } from "../plano";

const CHAVE = "tf-extra";
interface Salvo {
  valor: string;
  mes: string;
  separacoes: { nome: string; valor: string }[];
}

function ler(): Salvo | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? "null");
    return v && typeof v === "object" && Array.isArray(v.separacoes) ? v : null;
  } catch {
    return null;
  }
}
function gravar(s: Salvo) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(s));
  } catch {
    /* sem armazenamento local */
  }
}

/** "2027-03" → "março de 2027". */
const mesExtenso = (c: string | null | undefined) => {
  if (!c) return "";
  const [a, m] = c.split("-").map(Number);
  return `${MESES[m - 1]} de ${a}`;
};
const pct = (t: number | null | undefined) => (t == null ? "" : `${numero(Math.round(t * 1000) / 10)}% ao mês`);

function explicar(p: Passo): string {
  switch (p.tipo) {
    case "separado":
      return "Você já separou para isso.";
    case "atrasada":
      return p.quita ? "Está atrasada: cresce com multa e juros. Quitar primeiro." : "Está atrasada: paga uma parte agora; o resto continua devendo.";
    case "juros":
      return (
        `Juros de cerca de ${pct(p.taxa)}. Adiantar ${p.parcelas} ${p.parcelas === 1 ? "parcela" : "parcelas"} (as últimas) economiza ${reais(p.economia ?? 0)} em juros` +
        (p.quita ? " e quita a dívida." : `, e ela termina em ${mesExtenso(p.terminaEm)} em vez de ${mesExtenso(p.terminavaEm)}.`)
      );
    case "reserva":
      return "Completa a reserva de emergência, para não precisar se endividar num imprevisto.";
    case "desconhecida":
      return `Adianta ${p.parcelas ?? 1} ${(p.parcelas ?? 1) === 1 ? "parcela" : "parcelas"}. ${p.aviso ?? ""}`;
    case "sem_juros":
      return (
        `Sem juros: adiantar não economiza, só libera o dinheiro dos próximos meses` +
        (p.parcelas ? ` (${p.parcelas} ${p.parcelas === 1 ? "parcela" : "parcelas"}${p.quita ? ", quita" : `, termina em ${mesExtenso(p.terminaEm)}`})` : p.quita ? " (quita)" : "") +
        `. ${p.aviso ?? ""}`
      );
    case "sobra":
      return "O que sobrou depois de tudo: guarde na reserva ou deixe para o próximo plano.";
  }
}

const ROTULO: Record<Passo["tipo"], string> = {
  separado: "Já tem destino",
  atrasada: "Atrasada",
  juros: "Juros altos",
  reserva: "Reserva",
  desconhecida: "Juros desconhecidos",
  sem_juros: "Sem juros",
  sobra: "Sobra",
};

/** "Vou receber um dinheiro": separa o que já tem destino e sugere onde usar o resto. */
export function DinheiroExtra({ brutos, saldoReserva }: { brutos: Brutos; saldoReserva: number | null }) {
  const proximo = addMes(hojeISO().slice(0, 7), 1);
  const [f, setF] = useState<Salvo>(() => ler() ?? { valor: "", mes: proximo, separacoes: [] });
  const mudar = (n: Salvo) => {
    setF(n);
    gravar(n);
  };

  const valor = lerValor(f.valor) ?? 0;
  const mes = /^\d{4}-\d{2}$/.test(f.mes) ? f.mes : proximo;
  const cartao = useMemo(() => parcelasDoCartao(brutos), [brutos]);
  const cands = useMemo(() => candidatas(brutos, mes, cartao), [brutos, mes, cartao]);
  const meta = brutos.metas.find((m) => m.usar_reserva);
  const faltaReserva = meta ? Math.max(0, meta.valor_alvo - guardadoNaMeta(meta, saldoReserva)) : 0;
  const plano = valor > 0 ? planejar({ valor, mes, separacoes: f.separacoes.map((s) => ({ nome: s.nome.trim(), valor: lerValor(s.valor) ?? 0 })), candidatas: cands, faltaReserva }) : null;
  const separado = plano ? plano.passos.filter((p) => p.tipo === "separado").reduce((a, p) => a + p.valor, 0) : 0;

  const mudarSep = (i: number, campo: "nome" | "valor", v: string) => mudar({ ...f, separacoes: f.separacoes.map((s, j) => (j === i ? { ...s, [campo]: v } : s)) });

  return (
    <section className="panel extra" aria-labelledby="t-extra">
      <h2 id="t-extra">Vou receber um dinheiro</h2>
      <p className="desc">13º, férias, restituição: separe o que já tem destino e veja onde vale mais a pena usar o resto.</p>

      <div className="extra-entrada">
        <div className="field">
          <label htmlFor="ex-valor">Quanto vai entrar (R$)</label>
          <input id="ex-valor" type="text" inputMode="decimal" placeholder="Ex.: 3.500,00" value={f.valor} onChange={(e) => mudar({ ...f, valor: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ex-mes">Em que mês</label>
          <input id="ex-mes" type="month" value={mes} onChange={(e) => mudar({ ...f, mes: e.target.value })} />
        </div>
      </div>

      <div className="extra-destinos">
        <span className="rotulo-campo">Já tem destino</span>
        {f.separacoes.map((s, i) => (
          <div className="extra-destino" key={i}>
            <input type="text" maxLength={60} placeholder="Ex.: IPVA do ano que vem" aria-label={`Destino ${i + 1}`} value={s.nome} onChange={(e) => mudarSep(i, "nome", e.target.value)} />
            <input type="text" inputMode="decimal" placeholder="R$" aria-label={`Valor do destino ${i + 1}`} value={s.valor} onChange={(e) => mudarSep(i, "valor", e.target.value)} />
            <button type="button" className="btn-link" aria-label={`Remover destino ${s.nome || i + 1}`} onClick={() => mudar({ ...f, separacoes: f.separacoes.filter((_, j) => j !== i) })}>
              Remover
            </button>
          </div>
        ))}
        <button type="button" className="del" onClick={() => mudar({ ...f, separacoes: [...f.separacoes, { nome: "", valor: "" }] })}>
          Adicionar destino
        </button>
      </div>

      {!plano ? (
        <p className="note">Informe quanto vai entrar para ver a sugestão.</p>
      ) : plano.excedeu > 0 ? (
        <div className="erro">Os destinos somam mais que o valor que vai entrar: passam em {reais(plano.excedeu)}.</div>
      ) : (
        <>
          <h3 className="reserva-sub">Sugestão para {capitalizar(mesExtenso(mes))}</h3>
          <ol className="extra-passos">
            {plano.passos.map((p, i) => (
              <li key={i} className={"extra-passo " + p.tipo}>
                <span className="extra-num" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="extra-texto">
                  <b>{p.nome}</b>
                  <span className="pill">{ROTULO[p.tipo]}</span>
                  <span className="note">{explicar(p)}</span>
                </span>
                <span className="num extra-valor">{reais(p.valor)}</span>
              </li>
            ))}
          </ol>
          <div className="objetivo-destaque">
            <div>
              <span className="rot">Já tem destino</span>
              <strong className="num grande">{reais(separado)}</strong>
            </div>
            <div>
              <span className="rot">Sugerido</span>
              <strong className="num grande">{reais(valor - separado)}</strong>
            </div>
            <div>
              <span className="rot">Juros que deixa de pagar</span>
              <strong className="num grande pos">{reais(plano.economia)}</strong>
            </div>
          </div>
          <p className="note">
            É uma sugestão, nada é pago sozinho. Adiantar parcelas é pelo app do banco; o desconto exato da antecipação quem informa é o banco. Os juros que não
            estão cadastrados foram calculados pelo valor original e pelas parcelas.
          </p>
        </>
      )}
    </section>
  );
}
