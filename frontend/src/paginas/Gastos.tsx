import { useEffect, useMemo, useState } from "react";
import { api, type Brutos, type Movimentacao } from "../api";
import { GraficoCategoria } from "../componentes/Graficos";
import { Painel, Vazio } from "../componentes/Indicador";
import { SeletorCategoria } from "../componentes/SeletorCategoria";
import PartesDivididas from "../componentes/PartesDivididas";
import { NomeLancamento, tituloDe } from "../componentes/NomeLancamento";
import { data, mesAno, nomeCategoria, numero, reais } from "../formato";
import { catDe, compDe, ehGasto, mesesComDados, mesesDaJanela, ondeMaisGastou, resumoPorCategoria, temCategoria } from "../gastos";

type Janela = "12" | number;

const TODAS = "todas";

/** "#movimentos/<categoria>/mes-a-mes" → a categoria ("todas" é o ranking de todas). */
function categoriaDoEndereco(): string | null {
  const [, c, fim] = location.hash.split("/");
  if (fim !== "mes-a-mes" || !c || c === TODAS) return null;
  try {
    return decodeURIComponent(c);
  } catch {
    return c;
  }
}

function mesAtual() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
}

/** Análise mês a mês de uma categoria (esta página); sem categoria, o ranking de todas. */
export const linkMesAMes = (categoria: string | null) => `#movimentos/${categoria ? encodeURIComponent(categoria) : TODAS}/mes-a-mes`;

export default function Gastos({ brutos, aoMudar, categoria: inicial }: { brutos: Brutos; aoMudar: () => Promise<void>; categoria?: string | null }) {
  // A categoria vem do endereço (#movimentos/<categoria>/mes-a-mes); depois, cada troca de endereço é lida aqui mesmo.
  const [categoria, setCategoria] = useState<string | null>(() => (inicial !== undefined && inicial !== TODAS ? inicial : categoriaDoEndereco()));
  const [janela, setJanela] = useState<Janela>("12");
  const hoje = mesAtual();
  const movs = brutos.movimentacoes;

  useEffect(() => {
    const f = () => setCategoria(categoriaDoEndereco());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);

  function escolher(c: string | null) {
    history.replaceState(null, "", linkMesAMes(c));
    setCategoria(c);
    window.scrollTo({ top: 0 });
  }

  const anos = useMemo(() => [...new Set(movs.map((m) => Number(compDe(m).slice(0, 4))))].filter((a) => a > 2000).sort((a, b) => b - a), [movs]);
  const meses = useMemo(() => mesesDaJanela(janela, hoje), [janela, hoje]);
  const resumo = useMemo(() => resumoPorCategoria(movs, meses), [movs, meses]);
  const comDados = Math.max(1, mesesComDados(movs, meses));

  const seletorJanela = (
    <div className="segmentos" role="group" aria-label="Período">
      <button type="button" aria-pressed={janela === "12"} onClick={() => setJanela("12")}>
        Últimos 12 meses
      </button>
      {anos.map((a) => (
        <button key={a} type="button" aria-pressed={janela === a} onClick={() => setJanela(a)}>
          {a}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div className="gastos-topo">
        <div className="field">
          <label htmlFor="g-cat">Categoria</label>
          <select id="g-cat" value={categoria ?? ""} onChange={(e) => escolher(e.target.value || null)}>
            <option value="">Todas as categorias</option>
            {resumo.map((r) => (
              <option key={r.categoria} value={r.categoria}>
                {nomeCategoria(r.categoria)}
              </option>
            ))}
            {categoria && !resumo.some((r) => r.categoria === categoria) && <option value={categoria}>{nomeCategoria(categoria)}</option>}
          </select>
        </div>
        {seletorJanela}
      </div>
      {categoria ? (
        <DaCategoria
          categoria={categoria}
          brutos={brutos}
          meses={meses}
          comDados={comDados}
          resumo={resumo.find((r) => r.categoria === categoria) ?? null}
          hoje={hoje}
          aoVoltar={() => escolher(null)}
          aoMudar={aoMudar}
        />
      ) : (
        <Ranking resumo={resumo} comDados={comDados} aoEscolher={escolher} />
      )}
    </>
  );
}

function Ranking({ resumo, comDados, aoEscolher }: { resumo: ReturnType<typeof resumoPorCategoria>; comDados: number; aoEscolher: (c: string) => void }) {
  if (!resumo.length) return <Vazio titulo="Nenhum gasto no período">Os gastos aparecem por categoria assim que houver lançamentos.</Vazio>;
  const total = resumo.reduce((a, r) => a + r.total, 0);
  const maior = resumo[0].total;
  return (
    <Painel largo titulo="Quanto você gastou em cada categoria" descricao={`Soma do período e média por mês (${comDados} ${comDados === 1 ? "mês" : "meses"} com dados). Toque numa categoria para ver o detalhe.`}>
      <ul className="ranking">
        {resumo.map((r) => (
          <li key={r.categoria}>
            <button type="button" className="ranking-linha" onClick={() => aoEscolher(r.categoria)}>
              <span className="ranking-nome">{nomeCategoria(r.categoria)}</span>
              <span className="ranking-barra" aria-hidden="true">
                <i style={{ width: `${(r.total / maior) * 100}%` }} />
              </span>
              <span className="ranking-total num">{reais(r.total)}</span>
              <span className="ranking-media">
                <span className="num">{reais(r.total / comDados)}</span> por mês, {numero(Math.round((r.total / total) * 100))}% do total
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="cats-rodape">
        <span>
          Total <b className="num">{reais(total)}</b>
        </span>
        <span>
          Média <b className="num">{reais(total / comDados)}</b> por mês
        </span>
      </div>
    </Painel>
  );
}

function DaCategoria({
  categoria,
  brutos,
  meses,
  comDados,
  resumo,
  hoje,
  aoVoltar,
  aoMudar,
}: {
  categoria: string;
  brutos: Brutos;
  meses: string[];
  comDados: number;
  resumo: ReturnType<typeof resumoPorCategoria>[number] | null;
  hoje: string;
  aoVoltar: () => void;
  aoMudar: () => Promise<void>;
}) {
  const [limite, setLimite] = useState(30);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => setLimite(30), [categoria, meses]);

  const janela = useMemo(() => new Set(meses), [meses]);
  const lancs = useMemo(
    () => brutos.movimentacoes.filter((m) => ehGasto(m) && temCategoria(m, categoria) && janela.has(compDe(m))).sort((a, b) => b.data.localeCompare(a.data) || a.id.localeCompare(b.id)),
    [brutos.movimentacoes, categoria, janela],
  );
  const lugares = useMemo(() => ondeMaisGastou(brutos.movimentacoes, categoria, meses), [brutos.movimentacoes, categoria, meses]);
  const tipoConta = useMemo(() => new Map(brutos.contas.map((c) => [c.id, c.tipo ?? ""])), [brutos.contas]);

  const porMes = resumo?.porMes ?? meses.map(() => 0);
  const total = resumo?.total ?? 0;
  const media = total / comDados;
  const iMaior = porMes.reduce((mi, v, i) => (v > porMes[mi] ? i : mi), 0);
  const iAtual = meses.indexOf(hoje);
  const esteMes = iAtual >= 0 ? porMes[iAtual] : null;

  async function mudarCategoria(m: Movimentacao, cat: string) {
    setSalvando(m.id);
    setErro(null);
    try {
      await api.reclassificar(m.id, cat, true);
      await aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(null);
    }
  }

  return (
    <>
      <section className="gasto-cab" aria-labelledby="t-cat">
        <button type="button" className="btn-link" onClick={aoVoltar}>
          Voltar para todas as categorias
        </button>
        <h2 id="t-cat">{nomeCategoria(categoria)}</h2>
        <div className="frase">
          <div className="parte">
            <span className="rot">Total no período</span>
            <strong className="num enorme">{reais(total)}</strong>
            <span className="nota">
              {lancs.length} {lancs.length === 1 ? "lançamento" : "lançamentos"} de {mesAno(meses[0])} a {mesAno(meses[meses.length - 1])}
            </span>
          </div>
          <div className="parte">
            <span className="rot">Média por mês</span>
            <strong className="num enorme">{reais(media)}</strong>
            <span className="nota">
              {comDados} {comDados === 1 ? "mês" : "meses"} com dados
            </span>
          </div>
          <div className="parte">
            <span className="rot">{esteMes !== null ? "Este mês até agora" : "Mês com mais gasto"}</span>
            <strong className="num enorme">{reais(esteMes ?? porMes[iMaior])}</strong>
            <span className="nota">
              {esteMes !== null ? (
                media > 0 && <span className={esteMes > media ? "neg" : "pos"}>{esteMes > media ? `${reais(esteMes - media)} acima da média` : `${reais(media - esteMes)} abaixo da média`}</span>
              ) : (
                mesAno(meses[iMaior])
              )}
            </span>
          </div>
        </div>
      </section>

      <section className="grid">
        <Painel largo titulo="Mês a mês" descricao={`Barras em laranja: meses com gasto acima de 20% da média. Maior mês: ${mesAno(meses[iMaior])}, ${reais(porMes[iMaior])}.`}>
          {total > 0 ? <GraficoCategoria meses={meses} valores={porMes} media={media} /> : <Vazio titulo="Nenhum gasto nesta categoria">Escolha outro período ou outra categoria.</Vazio>}
        </Painel>

        <Painel titulo="Onde mais gastou" descricao="Compras do mesmo lugar somadas.">
          {lugares.length ? (
            <ul className="lugares">
              {lugares.slice(0, 10).map((l) => (
                <li key={l.lugar}>
                  <span className="lugar-nome">{l.lugar}</span>
                  <span className="num">{reais(l.total)}</span>
                  <span className="nota">
                    {l.vezes} {l.vezes === 1 ? "vez" : "vezes"}, {numero(Math.round((l.total / Math.max(total, 0.01)) * 100))}% da categoria
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Vazio titulo="Nada aqui ainda">Os lugares aparecem quando houver compras nesta categoria.</Vazio>
          )}
        </Painel>

        <Painel titulo="Lançamentos" descricao="Se algum estiver na categoria errada, troque aqui: os próximos iguais seguem a sua escolha.">
          {erro && <div className="erro">Não consegui mudar a categoria: {erro}</div>}
          {lancs.length ? (
            <ul className="gasto-lancs">
              {lancs.slice(0, limite).map((m) => (
                <li key={m.id} className="lanc">
                  <NomeLancamento m={m} aoMudar={aoMudar} />
                  <span className={"lanc-valor num" + (m.valor > 0 ? " pos" : "")}>{reais(m.valor)}</span>
                  <span className="lanc-meta">
                    <span>{data(m.data)}</span>
                    <span>{tipoConta.get(m.conta_id ?? "") === "cartao" ? "Cartão" : "Conta"}</span>
                    {m.parcela && <span>parcela {m.parcela.replace(/^0/, "").replace("/0", "/")}</span>}
                    {m.partes?.length ? (
                      <PartesDivididas m={m} />
                    ) : (
                      <SeletorCategoria className="lanc-cat" rotulo={`Categoria de ${tituloDe(m)}`} natureza={m.natureza} valor={catDe(m)} desativado={salvando === m.id} aoEscolher={(c) => mudarCategoria(m, c)} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Vazio titulo="Nenhum lançamento">Nada nesta categoria no período escolhido.</Vazio>
          )}
          {lancs.length > limite && (
            <button type="button" className="mais" onClick={() => setLimite((l) => l + 30)}>
              Mostrar mais ({lancs.length - limite} restantes)
            </button>
          )}
        </Painel>
      </section>
    </>
  );
}
