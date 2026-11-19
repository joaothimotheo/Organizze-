import type { Brutos, Holerite, Lancamento } from "../api";
import { GraficoDescontos, GRUPOS_DESCONTO } from "../componentes/Graficos";
import { Indicador, Painel, Vazio } from "../componentes/Indicador";
import { mesAno, porcento, reais } from "../formato";

/** Grupo de cada desconto; `null` = adiantamento já pago antes (não é desconto de verdade). */
function grupo(d: Lancamento): string | null {
  const t = d.tipo ?? "";
  if (t === "adiantamento") return null;
  if (t === "inss") return "INSS";
  if (t === "irrf") return "IRRF";
  if (t === "vale_refeicao") return "Vale-refeição";
  if (/uniforme/i.test(d.descricao)) return "Uniforme";
  if (t === "contribuicao_sindical") return "Contribuição sindical";
  return "Outros";
}

function descontos(h: Holerite) {
  const g: Record<string, number> = {};
  let adiantamento = 0;
  for (const d of h.descontos ?? []) {
    const k = grupo(d);
    if (!k) adiantamento += d.valor;
    else g[k] = (g[k] ?? 0) + d.valor;
  }
  return { g, adiantamento, total: Object.values(g).reduce((a, b) => a + b, 0) };
}

const liquidoDoMes = (h: Holerite) => h.liquido_competencia ?? h.liquido;

export default function Salarios({ brutos, ano, mes }: { brutos: Brutos; ano: number; mes: number | null }) {
  const todos = [...brutos.holerites].sort((a, b) => a.competencia.localeCompare(b.competencia));
  const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`);
  const doPeriodo = todos.filter((h) => (mes ? h.competencia === meses[mes - 1] : h.competencia.startsWith(`${ano}-`)));
  const bruto = doPeriodo.reduce((s, h) => s + h.bruto, 0);
  const liquido = doPeriodo.reduce((s, h) => s + liquidoDoMes(h), 0);
  const total = doPeriodo.reduce((s, h) => s + descontos(h).total, 0);
  const porGrupo: Record<string, number> = {};
  doPeriodo.forEach((h) => Object.entries(descontos(h).g).forEach(([k, v]) => (porGrupo[k] = (porGrupo[k] ?? 0) + v)));
  const maior = Object.entries(porGrupo).sort((a, b) => b[1] - a[1])[0];
  const n = doPeriodo.length;

  const porMes = meses.map((k) => {
    const hs = todos.filter((h) => h.competencia === k);
    if (!hs.length) return null;
    const g: Record<string, number> = {};
    hs.forEach((h) => Object.entries(descontos(h).g).forEach(([kk, v]) => (g[kk] = (g[kk] ?? 0) + v)));
    return g;
  });

  const uniforme = todos
    .map((h) => ({ k: h.competencia, v: (h.descontos ?? []).filter((d) => /uniforme/i.test(d.descricao)).reduce((s, d) => s + d.valor, 0) }))
    .filter((x) => x.v > 0);
  const temporario = brutos.descontosTemporarios.find((t) => /uniforme/i.test(t.descricao));
  const colunas = GRUPOS_DESCONTO.map(([g]) => g).filter((g) => todos.some((h) => descontos(h).g[g]));

  return (
    <>
      <section className="kpis" aria-label="Salário no período">
        <Indicador rotulo="Salário bruto" valor={n ? bruto : null} detalhe={n ? `${n} holerite${n > 1 ? "s" : ""} no período` : "Nenhum holerite no período"} />
        <Indicador
          rotulo="Total de descontos"
          valor={n ? total : null}
          detalhe={n ? `${porcento(bruto ? (total / bruto) * 100 : 0)} do bruto · maior: ${maior ? `${maior[0]} ${reais(maior[1])}` : "—"}` : "—"}
        />
        <Indicador rotulo="Líquido recebido" valor={n ? liquido : null} detalhe={n ? "Inclui férias pagas antes, quando houver" : "—"} />
      </section>
      <section className="grid">
        <Painel largo titulo="Descontos por mês" descricao="Tudo que sai do salário bruto antes de cair na conta, mês a mês no ano selecionado. O adiantamento de férias fica de fora porque já foi pago antes.">
          <GraficoDescontos ano={ano} porMes={porMes} />
        </Painel>
        <Painel largo titulo="Desconto de uniforme" descricao="Desconto que você acredita estar perto do fim.">
          {uniforme.length ? (
            <>
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      {uniforme.map((x) => (
                        <th key={x.k} style={{ textAlign: "right" }}>
                          {mesAno(x.k)}
                        </th>
                      ))}
                      <th style={{ textAlign: "right" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {uniforme.map((x) => (
                        <td key={x.k} className="n">
                          {reais(x.v)}
                        </td>
                      ))}
                      <td className="n">
                        <b>{reais(uniforme.reduce((s, x) => s + x.v, 0))}</b>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="callout">
                {temporario?.previsao_fim ? (
                  <>
                    Previsão de término: <b>{mesAno(temporario.previsao_fim)}</b>.{" "}
                  </>
                ) : null}
                {temporario?.obs}{" "}
                {!temporario?.previsao_fim && "Quando souber quantas parcelas faltam ou o valor total, me diga que eu marco o fim e retiro esse desconto das projeções."}
              </p>
            </>
          ) : (
            <Vazio titulo="Nenhum desconto de uniforme">Ele aparece aqui quando estiver em algum holerite.</Vazio>
          )}
        </Painel>
        <Painel largo titulo="Holerites" descricao="Cada desconto em sua coluna. Valores conferidos com os PDFs.">
          {todos.length ? (
            <>
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>Competência</th>
                      <th style={{ textAlign: "right" }}>Bruto</th>
                      {colunas.map((c) => (
                        <th key={c} style={{ textAlign: "right" }}>
                          {c}
                        </th>
                      ))}
                      <th style={{ textAlign: "right" }}>Total descontos</th>
                      <th style={{ textAlign: "right" }}>Líquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todos.map((h) => {
                      const d = descontos(h);
                      return (
                        <tr key={h.id}>
                          <td>
                            {mesAno(h.competencia)} {d.adiantamento > 0 && <span className="pill">férias</span>}
                            {h.status && h.status !== "confirmado" && <span className="pill warn">{h.status}</span>}
                          </td>
                          <td className="n">{reais(h.bruto)}</td>
                          {colunas.map((c) => (
                            <td key={c} className="n">
                              {d.g[c] ? reais(d.g[c]) : "—"}
                            </td>
                          ))}
                          <td className="n">{reais(d.total)}</td>
                          <td className="n">{reais(liquidoDoMes(h))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {todos.some((h) => descontos(h).adiantamento) && (
                <p className="note">Meses com férias: o líquido soma o valor pago antes das férias (no holerite ele aparece como "Desconto Adto Férias").</p>
              )}
            </>
          ) : (
            <Vazio titulo="Nenhum holerite">Envie seus holerites na aba Enviar.</Vazio>
          )}
        </Painel>
      </section>
    </>
  );
}
