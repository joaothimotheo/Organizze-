import { useMemo, useState, type ReactNode } from "react";
import type { Brutos, VisaoGeral } from "../api";
import {
  acimaDaMedia,
  faturaCartao,
  fechamento,
  fraseAcima,
  fraseCartao,
  fraseFechamento,
  fraseFuturas,
  fraseOrigem,
  frasePatrimonio,
  fraseSobra,
  gravarPeriodo,
  lerPeriodo,
  mesesDoPeriodo,
  mesFinal,
  origens,
  patrimonioPorMes,
  semOrigem,
  sobraPorMes,
  type Periodo,
} from "../analises";
import { GraficoAcimaDaMedia, GraficoCascata, GraficoFuturas, GraficoPatrimonioPeriodo, GraficoSobra } from "../componentes/Graficos";
import { hojeISO, MESES, reais } from "../formato";
import { destinoPendentes } from "../navegacao";

/** "AAAA-MM-DD" → "dd/mm" */
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const nomeMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1];

/** Destaca na frase os valores em reais (também mascarados), as porcentagens e "N de M meses". */
const DESTAQUE = /(-?R\$ (?:•+|\d{1,3}(?:\.\d{3})*(?:,\d{2})?)|\d+%|\d+ de \d+ (?:meses|mês))/;
function Frase({ texto }: { texto: string }) {
  const partes = texto.split(DESTAQUE);
  return <p className="an-resposta">{partes.map((p, i) => (i % 2 ? <em key={i}>{p}</em> : p))}</p>;
}

function Pergunta({ titulo, frase, children }: { titulo: string; frase: string; children?: ReactNode }) {
  return (
    <section className="panel an-cartao" aria-label={titulo}>
      <h2 className="an-pergunta">{titulo}</h2>
      <Frase texto={frase} />
      {children}
    </section>
  );
}

/** Lista de barras em HTML (fatura por grupo e origens), cada uma na cor do grupo. */
function Barras({ linhas, base }: { linhas: { nome: string; cor: string | null; valor: number }[]; base: number }) {
  return (
    <ul className="an-barras">
      {linhas.map((l) => (
        <li key={l.nome}>
          <span className="an-barras-nome">
            <i className="mv-sw" style={{ background: l.cor ? `var(--${l.cor})` : "var(--ink-3)" }} aria-hidden="true" />
            <span>{l.nome}</span>
          </span>
          <span className="an-barras-valor">{reais(l.valor)}</span>
          <span className="an-barras-trilho" aria-hidden="true">
            <i style={{ width: `${base > 0 ? Math.min(100, (l.valor / base) * 100) : 0}%`, background: l.cor ? `var(--${l.cor})` : "var(--ink-3)" }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Análises: seis perguntas, cada uma com a resposta escrita antes do gráfico. */
export default function Analises({ brutos, visao, ano, mes }: { brutos: Brutos; visao: VisaoGeral; ano: number; mes: number | null }) {
  const [periodo, setPeriodo] = useState<Periodo>(lerPeriodo);
  const hoje = hojeISO();
  const fim = mesFinal(ano, mes, hoje);
  const meses = useMemo(() => mesesDoPeriodo(fim, periodo), [fim, periodo]);

  // Só as contas ficam guardadas; as frases são refeitas a cada desenho (o modo "esconder valores" muda o texto).
  const dados = useMemo(() => {
    const movs = brutos.movimentacoes;
    return {
      fech: fechamento(brutos, fim, hoje),
      cartao: faturaCartao(brutos, hoje),
      sobra: sobraPorMes(brutos, meses, hoje),
      acima: acimaDaMedia(movs, brutos.categorias, meses, hoje),
      patrimonio: patrimonioPorMes(visao, meses),
      origens: origens(movs, brutos.categorias, fim, brutos.holerites),
      semOrigem: semOrigem(movs, fim),
    };
  }, [brutos, visao, fim, meses, hoje]);

  function escolher(p: Periodo) {
    setPeriodo(p);
    gravarPeriodo(p);
  }

  const { fech, cartao, sobra, acima, patrimonio } = dados;
  const fraseS = fraseSobra(sobra);
  const fraseA = fraseAcima(acima);
  const fraseP = frasePatrimonio(patrimonio);
  const totalEntradas = dados.origens.reduce((s, o) => s + o.valor, 0) + dados.semOrigem;
  const parcial = sobra.find((x) => x.parcial);

  const faltam = [
    ...fech.fixas.map((f) => ({ ...f, atrasada: f.dia < hoje })),
    ...fech.listaParcelas.map((p) => ({ ...p, atrasada: p.dia < hoje })),
  ].sort((x, y) => x.dia.localeCompare(y.dia) || x.nome.localeCompare(y.nome, "pt-BR"));

  return (
    <div className="analises">
      <div className="an-topo">
        <p className="note">Cada gráfico responde uma pergunta. A resposta vem escrita em cima.</p>
        <div className="an-periodo" role="group" aria-label="Período">
          {([3, 6] as Periodo[]).map((p) => (
            <button key={p} type="button" aria-pressed={periodo === p} onClick={() => escolher(p)}>
              {p} meses
            </button>
          ))}
        </div>
      </div>

      <div className="an-grade">
        <Pergunta titulo="Vou fechar o mês no azul?" frase={fraseFechamento(fech)}>
          {fech.atual && (
            <>
              {fech.passos.some((p) => Math.abs(p.valor) >= 0.5) && <GraficoCascata passos={fech.passos} fim={fech.fim} />}
              <p className="note">
                {faltam.length
                  ? `Faltam: ${faltam.map((f) => `${f.nome} (${diaMes(f.dia)}${f.atrasada ? ", atrasada" : ""})`).join(", ")}. `
                  : "Nenhuma conta fixa ou parcela faltando. "}
                Nenhuma entrada prevista até o fim do mês.
              </p>
            </>
          )}
        </Pergunta>

        <Pergunta titulo="Para onde vai o cartão?" frase={fraseCartao(cartao)}>
          {cartao && (
            <>
              {cartao.cartoes.length > 1 && (
                <ul className="an-cartoes">
                  {cartao.cartoes.map((k) => (
                    <li key={k.conta}>
                      <span>
                        {k.nome} <small>fatura de {nomeMes(k.mes)}</small>
                      </span>
                      <b>{reais(k.total)}</b>
                    </li>
                  ))}
                </ul>
              )}
              {cartao.linhas.length > 0 && <Barras linhas={cartao.linhas} base={Math.max(...cartao.linhas.map((l) => l.valor))} />}
              <p className="note">Pelas compras lançadas; pode diferir do saldo da fatura no banco.</p>
              <h3 className="an-pergunta an-sub">Já marcado nas próximas faturas</h3>
              {cartao.futuras.some((f) => f.valor > 0.004) && <GraficoFuturas futuras={cartao.futuras} />}
              <p className="note">{fraseFuturas(cartao)}</p>
            </>
          )}
        </Pergunta>

        <Pergunta titulo="Está sobrando dinheiro?" frase={fraseS}>
          {sobra.some((x) => !x.parcial) && (
            <>
              <GraficoSobra meses={sobra} />
              <div className="legend">
                <span>
                  <i style={{ background: "var(--good)" }} />
                  Sobrou
                </span>
                <span>
                  <i style={{ background: "var(--bad)" }} />
                  Faltou
                </span>
                {parcial && <span>* {nomeMes(parcial.mes)} ainda não acabou</span>}
              </div>
            </>
          )}
        </Pergunta>

        <Pergunta titulo="Onde gastei mais que o normal?" frase={fraseA}>
          {acima.length > 0 && (
            <>
              <GraficoAcimaDaMedia linhas={acima.slice(0, 6)} />
              <div className="legend">
                <span>
                  <i className="an-traco" />
                  Média dos meses anteriores do período
                </span>
              </div>
            </>
          )}
        </Pergunta>

        <Pergunta titulo="Meu patrimônio está crescendo?" frase={fraseP}>
          {patrimonio.length >= 2 && (
            <>
              <GraficoPatrimonioPeriodo pontos={patrimonio} />
              <p className="note">Patrimônio no fim de cada mês: o que você tem menos o que deve.</p>
            </>
          )}
        </Pergunta>

        <Pergunta titulo="De onde vem o meu dinheiro?" frase={fraseOrigem(dados.origens, fim, dados.semOrigem)}>
          {dados.origens.length > 0 && <Barras linhas={dados.origens} base={totalEntradas} />}
          {dados.semOrigem > 0.004 && (
            <a className="an-aviso" href={destinoPendentes()}>
              Ainda há entradas sem origem ({reais(dados.semOrigem)}). Organize em Movimentos para este gráfico ficar completo.
            </a>
          )}
        </Pergunta>
      </div>
    </div>
  );
}
