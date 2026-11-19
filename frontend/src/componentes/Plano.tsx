import { useEffect, useMemo, useState } from "react";
import { api, idsReserva, SemSessao, type Brutos, type EstadoSync } from "../api";
import { porPessoa } from "../emprestimos";
import { hojeISO, lerValor, mesAno, reais, addMes } from "../formato";
import { guardadoNaMeta, saldoReserva, simular, type AVista, type Parcelada } from "../plano";
import { sobraMediaDisponivel } from "../analises";

const CHAVE = "tf-plano-mensal";

function lerMensal(): string | null {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

/** Sem parcelas marcadas: IPVA atrasado, multa, conta para quitar de uma vez. */
const semParcelas = (d: Brutos["dividas"][number]) =>
  d.origem?.tipo === "informado" && d.situacao !== "quitada" && !((d.parcelas_restantes ?? 0) > 0 && (d.parcela_valor ?? 0) > 0);

/** Dívidas para pagar de uma vez, na ordem em que o plano quita: tributos primeiro, depois as menores. */
export function dividasAVista(brutos: Brutos): AVista[] {
  return [
    ...brutos.dividas
      .filter(semParcelas)
      .map((d) => ({ nome: d.nome ?? d.credor, valor: [...(d.saldos ?? [])].sort((a, b) => a.data.localeCompare(b.data)).pop()?.saldo_devedor ?? 0, ipva: d.tipo === "ipva" }))
      .sort((a, b) => Number(b.ipva) - Number(a.ipva) || a.valor - b.valor),
    ...porPessoa(brutos.emprestimos, "eu_devo")
      .map((p) => ({ nome: p.nome, valor: p.total }))
      .sort((a, b) => a.valor - b.valor),
  ]
    .filter((d) => d.valor > 0.004)
    .map(({ nome, valor }) => ({ nome, valor }));
}

/** O valor por mês do plano, o mesmo nas abas Dívidas e Objetivos. */
export function lerPorMes(sugestao: number): string {
  return lerMensal() ?? String(sugestao);
}
export function gravarPorMes(v: string) {
  try {
    localStorage.setItem(CHAVE, v);
  } catch {
    /* sem armazenamento local */
  }
}

/** Quando dá para quitar tudo e juntar a meta, com o que você consegue separar por mês. */
export function PlanoQuitacao({ brutos, parceladas }: { brutos: Brutos; parceladas: Parcelada[] }) {
  const mesAtual = hojeISO().slice(0, 7);
  const sugestao = useMemo(() => sobraMediaDisponivel(brutos.movimentacoes, mesAtual, brutos.holerites), [brutos.movimentacoes, brutos.holerites, mesAtual]);
  const [texto, setTexto] = useState(() => lerMensal() ?? String(sugestao));
  const [sync, setSync] = useState<EstadoSync | null>(null);
  useEffect(() => {
    api.sincronizacao().then(setSync, (e) => {
      if (!(e instanceof SemSessao)) setSync(null);
    });
  }, []);

  const porMes = lerValor(texto) ?? 0;
  // Tributos e multas primeiro: são os que crescem com juros.
  const avista: AVista[] = dividasAVista(brutos);
  const reserva = saldoReserva(sync?.ultima_ok?.contas, idsReserva(brutos.contas));
  const meta = brutos.metas[0] ? { nome: brutos.metas[0].nome, falta: Math.max(0, brutos.metas[0].valor_alvo - guardadoNaMeta(brutos.metas[0], reserva)) } : null;
  const p = simular(parceladas, avista, meta, porMes, addMes(mesAtual, 1));

  function mudar(v: string) {
    setTexto(v);
    try {
      localStorage.setItem(CHAVE, v);
    } catch {
      /* sem armazenamento local */
    }
  }

  const nada = !parceladas.length && !avista.length;
  return (
    <>
      <div className="plano-entrada">
        <div className="field">
          <label htmlFor="plano-mensal">Quanto você consegue separar por mês, além das parcelas (R$)</label>
          <input id="plano-mensal" type="text" inputMode="decimal" value={texto} onChange={(e) => mudar(e.target.value)} />
        </div>
        <p className="note">
          {sugestao > 0
            ? `Nos últimos 3 meses sobrou, em média, cerca de ${reais(sugestao)} por mês.`
            : "Não deu para calcular quanto sobra por mês: informe um valor."}{" "}
          {sugestao > 0 && lerValor(texto) !== sugestao && (
            <button type="button" className="btn-link" onClick={() => mudar(String(sugestao))}>
              Usar {reais(sugestao)}
            </button>
          )}
        </p>
      </div>

      {nada ? (
        <p className="note">Nenhuma dívida em aberto. {meta && p.meta ? `A meta "${meta.nome}" fica completa em ${mesAno(p.meta)}.` : ""}</p>
      ) : (
        <>
          <div className="plano-resumo">
            <div>
              <span className="rot">Livre de todas as dívidas</span>
              <strong className="num grande">{p.livre ? mesAno(p.livre) : "Mais de 10 anos"}</strong>
              <span className="nota">
                {reais(p.totalParcelado)} em parcelas e {reais(p.totalAVista)} para pagar de uma vez
              </span>
            </div>
            {meta && (
              <div>
                <span className="rot">{meta.nome}</span>
                <strong className="num grande">{p.meta ? mesAno(p.meta) : "Mais de 10 anos"}</strong>
                <span className="nota">{meta.falta > 0 ? `Faltam ${reais(meta.falta)}; começa depois das dívidas sem parcelas` : "Meta já alcançada"}</span>
              </div>
            )}
          </div>
          <ol className="plano-linha">
            {p.eventos.map((e) => (
              <li key={e.tipo + e.nome + e.mes} className={"plano-" + e.tipo}>
                <span className="plano-mes">{mesAno(e.mes)}</span>
                <span>
                  {e.tipo === "parcelada" ? `Última parcela de ${e.nome}` : e.tipo === "avista" ? `${e.nome} quitado` : `Meta "${e.nome}" completa`}
                </span>
              </li>
            ))}
          </ol>
          <p className="note">
            Como a conta é feita: as parcelas seguem sendo pagas todo mês. O valor acima quita primeiro as dívidas sem parcelas (tributos atrasados antes, porque
            os juros crescem) e depois vai para a meta. Quando uma dívida parcelada termina, o valor da parcela passa a somar no que dá para separar. É uma
            estimativa: juros novos, gastos fora do comum ou mudança de salário mudam as datas.
          </p>
        </>
      )}
    </>
  );
}

