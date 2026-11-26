import { useMemo } from "react";
import type { Brutos } from "../api";
import { mesDoFechamento, resumoDoMes } from "../fechamento";
import { addMes, capitalizar, hojeISO, MESES, reais } from "../formato";

const nomeMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1];
const mesAno = (mes: string) => `${nomeMes(mes)}/${mes.slice(0, 4)}`;

/** Fechamento do mês: o resumo de um mês já terminado, para ler e guardar em PDF (impressão do navegador). */
export default function Fechamento({ brutos, detalhe }: { brutos: Brutos; detalhe: string | null }) {
  const hoje = hojeISO();
  const mes = mesDoFechamento(detalhe, hoje);
  const anterior = addMes(mes, -1);
  const proximo = addMes(mes, 1);
  const podeAvancar = proximo < hoje.slice(0, 7);
  const r = useMemo(() => resumoDoMes(brutos, mes), [brutos, mes]);

  return (
    <article className="fechamento" aria-label={`Fechamento de ${mesAno(mes)}`}>
      <header className="fe-topo">
        <h1>Fechamento de {mesAno(mes)}</h1>
        <div className="fe-nav" role="group" aria-label="Mês do fechamento">
          <a className="fe-botao" href={`#fechamento/${anterior}`}>
            {capitalizar(nomeMes(anterior))}
          </a>
          {podeAvancar ? (
            <a className="fe-botao" href={`#fechamento/${proximo}`}>
              {capitalizar(nomeMes(proximo))}
            </a>
          ) : (
            <span className="fe-botao desabilitado" aria-disabled="true">
              {capitalizar(nomeMes(proximo))}
            </span>
          )}
        </div>
      </header>

      {r.vazio ? (
        <section className="panel">
          <p className="note">Nada lançado em {mesAno(mes)}.</p>
        </section>
      ) : (
        <>
          <section className="panel fe-resposta">
            {r.sobra >= 0 ? (
              <p>
                Sobrou <b className="pos">{reais(r.sobra)}</b> — o mês fechou no azul.
              </p>
            ) : (
              <p>
                Faltou <b className="neg">{reais(-r.sobra)}</b> — o mês fechou no vermelho.
              </p>
            )}
            <div className="fe-totais">
              <div>
                <span className="rot">Entrou</span>
                <strong className="num">{reais(r.entrou)}</strong>
              </div>
              <div>
                <span className="rot">Saiu</span>
                <strong className="num">{reais(r.saiu)}</strong>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>O que mais cresceu (vs. {nomeMes(anterior)})</h2>
            {r.cresceram.length ? (
              <ul className="fe-lista">
                {r.cresceram.map((c) => (
                  <li key={c.nome}>
                    <span>{c.nome}</span>
                    <span className="num">{reais(c.valor)}</span>
                    <span className="num neg">+{reais(c.diferenca)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="note">{r.semGastoAnterior ? `Sem gastos em ${nomeMes(anterior)} para comparar.` : `Nenhum gasto cresceu em relação a ${nomeMes(anterior)}.`}</p>
            )}
          </section>

          <section className="panel fe-linhas">
            <div>
              <span className="rot">Dívidas</span>
              <span>
                <b className="num">{reais(r.dividas)}</b> pagos
              </span>
            </div>
            <div>
              <span className="rot">Objetivos</span>
              <span>
                <b className="num">{reais(r.guardado)}</b> guardados na reserva
              </span>
            </div>
            <div>
              <span className="rot">Contas fixas</span>
              <span>
                {r.fixas.total === 0
                  ? "Nenhuma conta fixa cadastrada"
                  : `${r.fixas.pagas} de ${r.fixas.total} pagas`}
                {r.fixas.faltaram.length > 0 && ` · faltou: ${r.fixas.faltaram.map((f) => `${f.nome} (${reais(f.valor)})`).join(", ")}`}
              </span>
            </div>
          </section>
        </>
      )}

      <div className="fe-acoes">
        <button type="button" onClick={() => window.print()}>
          Baixar PDF
        </button>
        <p className="note">Abre a impressão do navegador: escolha "Salvar como PDF". Se estiver escondendo os valores, o PDF sai escondido também.</p>
      </div>
    </article>
  );
}
