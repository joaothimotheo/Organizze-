import { useState } from "react";
import { idsReserva, type Brutos, type Meta } from "../api";
import { hojeISO, data, mesAno, reais } from "../formato";
import { guardadoNaMeta } from "../plano";
import { resumoReserva } from "../reserva";
import { GraficoReserva } from "./Graficos";

/** Reserva de emergência: quanto tem, quanto rendeu e como cresceu mês a mês. */
export function QuadroReserva({ brutos, saldoHoje }: { brutos: Brutos; saldoHoje: number | null }) {
  const [tabela, setTabela] = useState(false);
  const ids = idsReserva(brutos.contas);
  if (!ids.size) return null;
  const mesAtual = hojeISO().slice(0, 7);
  const r = resumoReserva(brutos.movimentacoes, brutos.saldosContas, ids, mesAtual, saldoHoje);
  const meta: Meta | undefined = brutos.metas.find((m) => m.usar_reserva);
  const pct = meta && r.saldo !== null && meta.valor_alvo > 0 ? Math.min(100, (guardadoNaMeta(meta, r.saldo) / meta.valor_alvo) * 100) : null;
  const nomes = brutos.contas.filter((c) => ids.has(c.id)).map((c) => c.instituicao || c.apelido || "Reserva");

  return (
    <section className="panel reserva" aria-labelledby="t-reserva">
      <h2 id="t-reserva">Reserva de emergência</h2>
      <p className="desc">Saldo de {nomes.join(" e ")}, o que entrou, o que saiu e quanto rendeu.</p>
      <div className="objetivo-destaque">
        <div>
          <span className="rot">Saldo hoje</span>
          <strong className="num grande">{r.saldo !== null ? reais(r.saldo) : "Sem dado"}</strong>
          <span className="nota">
            {r.variacaoMes !== null ? (
              <>
                <span className={r.variacaoMes >= 0 ? "pos" : "neg"}>
                  {r.variacaoMes >= 0 ? "+" : "−"}
                  {reais(Math.abs(r.variacaoMes))}
                </span>{" "}
                desde o fim do mês passado
              </>
            ) : (
              "Sincronize para ver a variação"
            )}
          </span>
        </div>
        <div>
          <span className="rot">Rendeu este mês</span>
          <strong className="num grande pos">{reais(r.rendeuMes)}</strong>
          <span className="nota">{r.ultimoRendimento ? `Último: ${reais(r.ultimoRendimento.valor)} em ${data(r.ultimoRendimento.data)}` : "Nenhum rendimento lançado ainda"}</span>
        </div>
        <div>
          <span className="rot">Rendeu no período</span>
          <strong className="num grande pos">{reais(r.rendeu12)}</strong>
          <span className="nota">{r.meses.length ? `De ${mesAno(r.meses[0].mes)} até hoje` : "Sem histórico"}</span>
        </div>
        {meta && pct !== null && (
          <div>
            <span className="rot">Meta: {reais(meta.valor_alvo)}</span>
            <strong className="num grande">{Math.round(pct)}%</strong>
            <div className="medidor" aria-hidden="true">
              <i style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>

      <h3 className="reserva-sub">Saldo no fim de cada mês</h3>
      <GraficoReserva meses={r.meses} />
      <button type="button" className="btn-link" aria-expanded={tabela} onClick={() => setTabela((v) => !v)}>
        {tabela ? "Esconder a tabela" : "Ver mês a mês em tabela"}
      </button>
      {tabela && (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th style={{ textAlign: "right" }}>Guardou</th>
                <th style={{ textAlign: "right" }}>Tirou</th>
                <th style={{ textAlign: "right" }}>Rendeu</th>
                <th style={{ textAlign: "right" }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {[...r.meses].reverse().map((m) => (
                <tr key={m.mes}>
                  <td>{mesAno(m.mes)}</td>
                  <td className="n">{m.guardou ? reais(m.guardou) : "—"}</td>
                  <td className="n">{m.tirou ? reais(m.tirou) : "—"}</td>
                  <td className="n pos">{m.rendeu ? reais(m.rendeu) : "—"}</td>
                  <td className="n">{m.saldo !== null ? reais(m.saldo) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
