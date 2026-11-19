import { useEffect, useMemo, useState } from "react";
import { api, idsReserva, SemSessao, type Brutos, type EstadoSync } from "../api";
import { dividasAVista, gravarPorMes, lerPorMes } from "../componentes/Plano";
import { QuadroReserva } from "../componentes/QuadroReserva";
import { DinheiroExtra } from "../componentes/DinheiroExtra";
import { addMes, capitalizar, hojeISO, lerValor, MESES, reais } from "../formato";

/** "2027-01" → "Janeiro de 2027". */
const mesAno = (c: string | null | undefined) => {
  if (!c) return "";
  const [a, m] = c.split("-").map(Number);
  return `${capitalizar(MESES[m - 1])} de ${a}`;
};
import { guardadoNaMeta, saldoReserva, simular } from "../plano";
import { sobraMediaDisponivel } from "../analises";
import { parceladasAtivas } from "../dividas";
import Metas from "./Metas";

/**
 * Objetivos: quitar as dívidas e juntar dinheiro para as metas. No topo, o simulador
 * "se eu guardar R$ X por mês"; embaixo, as metas, cada uma com as duas contas
 * (quando chego lá com esse valor e quanto preciso guardar para chegar no prazo).
 */
export default function Objetivos({ brutos, aoMudar }: { brutos: Brutos; aoMudar: () => Promise<void> }) {
  const mesAtual = hojeISO().slice(0, 7);
  const inicio = addMes(mesAtual, 1);
  const sugestao = useMemo(() => sobraMediaDisponivel(brutos.movimentacoes, mesAtual, brutos.holerites), [brutos.movimentacoes, brutos.holerites, mesAtual]);
  const [texto, setTexto] = useState(() => lerPorMes(sugestao));
  const [sync, setSync] = useState<EstadoSync | null>(null);
  useEffect(() => {
    api.sincronizacao().then(setSync, (e) => {
      if (!(e instanceof SemSessao)) setSync(null);
    });
  }, []);

  const porMes = Math.max(0, lerValor(texto) ?? 0);
  const reserva = saldoReserva(sync?.ultima_ok?.contas, idsReserva(brutos.contas));
  const parceladas = useMemo(() => parceladasAtivas(brutos), [brutos]);
  const avista = useMemo(() => dividasAVista(brutos), [brutos]);
  const metas = brutos.metas.map((m) => ({ id: m.id, nome: m.nome, falta: Math.max(0, m.valor_alvo - guardadoNaMeta(m, reserva)) }));
  const p = simular(parceladas, avista, metas, porMes, inicio);
  const previsoes = new Map(metas.map((m, i) => [m.id, p.metas[i] ?? null]));
  const fixasPorMes = brutos.fixas.filter((f) => f.ativa).reduce((a, f) => a + f.valor, 0);
  const temDividas = parceladas.length > 0 || avista.length > 0;
  const maxRegua = Math.max(3000, Math.ceil((sugestao * 3) / 500) * 500, Math.ceil(porMes / 500) * 500);

  function mudar(v: string) {
    setTexto(v);
    gravarPorMes(v);
  }

  return (
    <>
      <QuadroReserva brutos={brutos} saldoHoje={reserva} />
      <DinheiroExtra brutos={brutos} saldoReserva={reserva} />
      <section className="panel simulador" aria-labelledby="t-sim">
        <h2 id="t-sim">Se eu guardar por mês…</h2>
        <p className="desc">
          Mexa no valor e veja quando você fica livre das dívidas e quando alcança cada meta. É o que dá para separar além das parcelas que você já paga.
        </p>
        <div className="simulador-entrada">
          <div className="field">
            <label htmlFor="sim-valor">Valor por mês (R$)</label>
            <input id="sim-valor" type="text" inputMode="decimal" value={texto} onChange={(e) => mudar(e.target.value)} />
          </div>
          <div className="field" style={{ flex: "1 1 260px" }}>
            <label htmlFor="sim-regua">Ajuste rápido</label>
            <input id="sim-regua" className="regua" type="range" min={0} max={maxRegua} step={50} value={Math.min(porMes, maxRegua)} onChange={(e) => mudar(e.target.value)} />
          </div>
        </div>
        <p className="note">
          {sugestao > 0 ? `Nos últimos 3 meses sobrou, em média, cerca de ${reais(sugestao)} por mês.` : "Ainda não deu para calcular quanto sobra por mês."}{" "}
          {sugestao > 0 && lerValor(texto) !== sugestao && (
            <button type="button" className="btn-link" onClick={() => mudar(String(sugestao))}>
              Usar {reais(sugestao)}
            </button>
          )}
          {fixasPorMes > 0 && ` As suas contas fixas somam ${reais(fixasPorMes)} por mês e já estão dentro dessa sobra.`}
        </p>

        <div className="objetivo-destaque">
          <div>
            <span className="rot">Livre de todas as dívidas</span>
            <strong className="num grande">{!temDividas ? "Já está" : p.livre ? mesAno(p.livre) : "Mais de 10 anos"}</strong>
            <span className="nota">{temDividas ? `${reais(p.totalParcelado)} em parcelas e ${reais(p.totalAVista)} para pagar de uma vez` : "Nenhuma dívida em aberto"}</span>
          </div>
          {metas.map((m, i) => (
            <div key={m.id}>
              <span className="rot">{m.nome}</span>
              <strong className="num grande">{m.falta <= 0 ? "Alcançada" : p.metas[i] ? mesAno(p.metas[i]) : "Mais de 10 anos"}</strong>
              <span className="nota">{m.falta > 0 ? `Faltam ${reais(m.falta)}` : "Meta já alcançada"}</span>
            </div>
          ))}
        </div>

        {p.eventos.length > 0 && (
          <ol className="objetivos-linha" aria-label="Linha do tempo">
            {p.eventos.map((e) => (
              <li key={e.tipo + e.nome + e.mes} className={"objetivo-passo " + e.tipo}>
                <span className="objetivo-bolinha" aria-hidden="true" />
                <span>{e.tipo === "parcelada" ? `Última parcela de ${e.nome}` : e.tipo === "avista" ? `${e.nome} quitado` : `Meta "${e.nome}" completa`}</span>
                <span className="objetivo-quando">{mesAno(e.mes)}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="note">
          Como a conta é feita: as parcelas seguem sendo pagas todo mês. O valor acima quita primeiro as dívidas sem parcelas (tributos atrasados antes) e depois
          vai para as metas, uma de cada vez, na ordem da lista. Quando um parcelamento termina, a parcela dele passa a somar no que dá para guardar. É uma
          estimativa: juros, gastos fora do comum ou mudança de salário mudam as datas.
        </p>
      </section>

      <Metas brutos={brutos} aoMudar={aoMudar} porMes={porMes} previsoes={previsoes} inicio={inicio} />
    </>
  );
}
