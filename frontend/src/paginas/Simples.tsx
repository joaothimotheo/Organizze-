import { useEffect, useState } from "react";
import { api, idsReserva, SemSessao, type Brutos, type EstadoSync, type VisaoGeral as Visao } from "../api";
import { totalEmAberto } from "../emprestimos";
import { mesesDaBarra, sobraDoPeriodo } from "../analises";
import { data, hojeISO, MESES, nomeCategoria, reais } from "../formato";
import { situacaoAgora } from "./VisaoGeral";
import { tituloDe } from "../componentes/NomeLancamento";

/** Modo simples: só o essencial, sem filtros nem gráficos. Sempre o mês atual. */
export default function Simples({ visao, brutos, comBanco, aoCompleto }: { visao: Visao; brutos: Brutos; comBanco: boolean; aoCompleto: () => void }) {
  const [sync, setSync] = useState<EstadoSync | null>(null);
  useEffect(() => {
    if (!comBanco) return setSync(null);
    api.sincronizacao().then(setSync, (e) => {
      if (!(e instanceof SemSessao)) setSync(null);
    });
  }, [visao, comBanco]);

  const { saldo, cartao, vence, quando, reserva } = situacaoAgora(visao, sync, idsReserva(brutos.contas));
  const meDevem = totalEmAberto(brutos.emprestimos, "me_deve");
  const devoPessoas = totalEmAberto(brutos.emprestimos, "eu_devo");
  const devoBancos = visao.indicadores.dividas_total ?? 0;
  const devo = devoBancos + devoPessoas;
  // Os mesmos números do "Sobrou" do Início completo (o mês de hoje só até hoje).
  const f = sobraDoPeriodo(brutos.movimentacoes, mesesDaBarra(visao.periodo.ano, visao.periodo.mes), hojeISO(), brutos.holerites);
  const vazio = f.entrou < 0.005 && f.saiu < 0.005;
  const mes = visao.periodo.mes ? MESES[visao.periodo.mes - 1] : String(visao.periodo.ano);
  const ultimos = brutos.movimentacoes
    .filter((m) => m.natureza !== "transferencia_interna")
    .sort((a, b) => b.data.localeCompare(a.data) || b.id.localeCompare(a.id))
    .slice(0, 5);

  return (
    <>
      <section className="simples" aria-label="Resumo">
        <div className="simples-item">
          <span className="rot">Na conta</span>
          <strong className={"num enorme" + (saldo !== null && saldo < 0 ? " neg" : "")}>{saldo === null ? "Sem dados" : reais(saldo)}</strong>
          <span className="nota">
            {quando ? `Atualizado em ${quando}` : "Pelo último extrato enviado"}
            {reserva !== null && `. Reserva à parte: ${reais(reserva)}`}
          </span>
        </div>
        <div className="simples-item">
          <span className="rot">Fatura do cartão</span>
          <strong className="num enorme">{cartao ? reais(cartao.saldo ?? 0) : "Sem dados"}</strong>
          <span className="nota">{vence ? `Vence em ${data(vence)}` : comBanco ? "Aparece quando o cartão estiver conectado" : "No modelo por documentos, veja a aba Dívidas"}</span>
        </div>
        <a className="simples-item" href="#pessoas">
          <span className="rot">Me devem</span>
          <strong className="num enorme pos">{reais(meDevem)}</strong>
          <span className="nota">{meDevem > 0 ? "Ver quem na aba Pessoas" : "Ninguém te deve agora"}</span>
        </a>
        <a className="simples-item" href="#dividas">
          <span className="rot">Eu devo</span>
          <strong className={"num enorme" + (devo > 0 ? " neg" : "")}>{reais(devo)}</strong>
          <span className="nota">
            {devo > 0 ? `Bancos e cartão ${reais(devoBancos)}, pessoas ${reais(devoPessoas)}` : "Nenhuma dívida registrada"}
          </span>
        </a>
      </section>

      <section className="panel simples-mes">
        {!vazio ? (
          <p className="frase-simples">
            Em {mes} entrou <b className="num pos">{reais(f.entrou)}</b> e saiu <b className="num">{reais(f.saiu)}</b>.{" "}
            {f.sobra >= 0 ? (
              <>
                Sobraram <b className="num pos">{reais(f.sobra)}</b>.
              </>
            ) : (
              <>
                Saiu <b className="num neg">{reais(-f.sobra)}</b> a mais do que entrou.
              </>
            )}
          </p>
        ) : (
          <p className="frase-simples">Em {mes} ainda não há movimentações.</p>
        )}
        <p className="nota">Transferências entre suas contas e pagamento de dívidas não entram aqui.</p>
        {ultimos.length > 0 && (
          <>
            <h2>Últimos lançamentos</h2>
            <ul className="simples-lancs">
              {ultimos.map((m) => (
                <li key={m.id}>
                  <span className="lanc-nome">{tituloDe(m)}</span>
                  <span className={"num" + (m.valor > 0 ? " pos" : "")}>{reais(m.valor)}</span>
                  <span className="nota">
                    {data(m.data)}, {nomeCategoria(m.categoria)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <button type="button" className="btn-link" onClick={aoCompleto}>
          Ver gráficos, categorias e todos os lançamentos no modo completo
        </button>
      </section>
    </>
  );
}
