import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Brutos, type Grupo, type NovoGrupo } from "../api";
import { Painel } from "../componentes/Indicador";
import JanelaGrupo from "../componentes/JanelaGrupo";
import { MESES, reais } from "../formato";
import { lancamentosPorGrupo, NATUREZAS_NAO_CONTA, proximaCor, usoNoPeriodo, type TipoGrupo } from "../grupos";

type Sugestao = { detalhe: string; lancamentos: string[]; total: number };
const msgDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const vezes = (n: number) => (n === 1 ? "1 lançamento" : `${n} lançamentos`);

/**
 * Tela Categorias (depois de migrar): os seus grupos de gasto, sugestões a partir de Outros
 * gastos, as origens de entrada e o que não conta no mês.
 */
export default function Categorias({
  brutos,
  ano,
  mes,
  aoMudar,
  avisar,
}: {
  brutos: Brutos;
  ano: number;
  mes: number | null;
  aoMudar: () => Promise<void>;
  avisar: (texto: string) => void;
}) {
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [janela, setJanela] = useState<{ tipo: TipoGrupo; inicial?: Grupo } | null>(null);

  const ler = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([api.categorias(), api.sugestoes()]);
      setGrupos(c.grupos);
      setSugestoes(s);
      setErro(null);
    } catch (e) {
      setErro(`Não consegui carregar os grupos: ${msgDe(e)}`);
    }
  }, []);

  useEffect(() => {
    ler();
  }, [ler]);

  /** Depois de qualquer mudança: relê os grupos daqui e os dados do app. */
  const mudou = useCallback(
    async (texto: string) => {
      avisar(texto);
      await Promise.all([ler(), aoMudar()]);
    },
    [ler, aoMudar, avisar],
  );

  const uso = useMemo(() => usoNoPeriodo(brutos.movimentacoes, ano, mes), [brutos.movimentacoes, ano, mes]);
  // Conta também os divididos com alguma parte no grupo (o servidor move esses ao apagar).
  const total = useMemo(() => lancamentosPorGrupo(brutos.movimentacoes), [brutos.movimentacoes]);

  const gasto = (grupos ?? []).filter((g) => g.tipo === "gasto");
  const entrada = (grupos ?? []).filter((g) => g.tipo === "entrada");
  const periodo = mes === null ? `em ${ano}` : `em ${MESES[mes - 1]}`;
  const corDe = (tipo: TipoGrupo) => proximaCor((tipo === "gasto" ? gasto : entrada).filter((g) => !g.padrao).map((g) => g.cor));

  async function salvar(g: NovoGrupo) {
    const inicial = janela?.inicial;
    if (inicial) {
      await api.editarGrupo(inicial.id, g);
      setJanela(null);
      await mudou(`"${inicial.padrao ? inicial.nome : g.nome}" salvo.`);
    } else {
      const r = await api.criarGrupo(g);
      setJanela(null);
      await mudou(`"${r.grupo.nome}" criado.`);
    }
  }

  const item = (g: Grupo) => (
    <ItemGrupo
      key={g.id}
      g={g}
      uso={uso.get(g.id)}
      lancamentos={total.get(g.id) ?? 0}
      aoEditar={() => setJanela({ tipo: g.tipo, inicial: g })}
      aoApagado={(movidos) => mudou(`"${g.nome}" apagado${movidos ? `; ${vezes(movidos)} foram para ${g.tipo === "entrada" ? "Outras entradas" : "Outros gastos"}` : ""}.`)}
    />
  );

  return (
    <>
      {erro && <div className="erro">{erro}</div>}
      {!grupos && !erro && <p className="note">Carregando…</p>}
      {grupos && (
        <div className="grid categorias">
          <div className="categorias-coluna">
            <Painel titulo="Seus grupos de gasto" descricao={`Ao categorizar, você escolhe só o grupo; o detalhe é opcional. Ao lado de cada um, o uso ${periodo}.`}>
              <div className="row">
                <button type="button" className="primary" onClick={() => setJanela({ tipo: "gasto" })}>
                  Criar grupo
                </button>
              </div>
              <div className="grupo-grade">{gasto.map(item)}</div>
            </Painel>

            {sugestoes.length > 0 && (
              <Painel titulo="Sugestões a partir de Outros gastos" descricao="Lançamentos parecidos estão parados em Outros gastos. Crie o grupo e eles vão juntos.">
                <ul className="grupo-sugestoes">
                  {sugestoes.map((s) => (
                    <ItemSugestao key={s.detalhe} s={s} cor={corDe("gasto")} aoCriado={(nome, movidos) => mudou(`"${nome}" criado; ${vezes(movidos)} saíram de Outros gastos.`)} />
                  ))}
                </ul>
              </Painel>
            )}
          </div>

          <div className="categorias-coluna">
            <Painel titulo="Entradas: de onde veio" descricao={`Toda entrada ganha uma origem. Crie as suas além das que já vêm no app. Ao lado, o uso ${periodo}.`}>
              <div className="row">
                <button type="button" onClick={() => setJanela({ tipo: "entrada" })}>
                  Criar origem
                </button>
              </div>
              <div className="grupo-grade um">{entrada.map(item)}</div>
            </Painel>

            <Painel titulo="Não contam no mês" descricao="Ficam fora de entrou e saiu, para não inflar gastos nem ganhos. Não dá para apagar.">
              <NaoConta titulo="Saídas" itens={NATUREZAS_NAO_CONTA.saida} />
              <NaoConta titulo="Entradas" itens={NATUREZAS_NAO_CONTA.entrada} />
            </Painel>
          </div>
        </div>
      )}
      {janela && (
        <JanelaGrupo tipo={janela.tipo} inicial={janela.inicial} corSugerida={corDe(janela.tipo)} aoSalvar={salvar} aoFechar={() => setJanela(null)} />
      )}
    </>
  );
}

function ItemGrupo({
  g,
  uso,
  lancamentos,
  aoEditar,
  aoApagado,
}: {
  g: Grupo;
  uso?: { vezes: number; valor: number };
  lancamentos: number;
  aoEditar: () => void;
  aoApagado: (movidos: number) => Promise<void>;
}) {
  const [apagando, setApagando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const destino = g.tipo === "entrada" ? "Outras entradas" : "Outros gastos";

  async function apagar() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.apagarGrupo(g.id);
      await aoApagado(r.movidos);
    } catch (e) {
      setErro(msgDe(e));
      setOcupado(false);
    }
  }

  return (
    <div className="grupo-item">
      <i className="grupo-sw" style={{ background: `var(--${g.cor})` }} aria-hidden="true" />
      <div className="grupo-texto">
        <b>{g.nome}</b>
        {g.padrao && <span className="grupo-padrao">padrão</span>}
        <small>{g.detalhes.length ? `Detalhes: ${g.detalhes.join(" · ")}` : "Sem detalhes"}</small>
        <span className="grupo-acoes">
          <button type="button" className="btn-link" onClick={aoEditar}>
            Editar
          </button>
          {!g.padrao && !apagando && (
            <button type="button" className="btn-link" onClick={() => setApagando(true)}>
              Apagar
            </button>
          )}
        </span>
        {apagando && (
          <div className="grupo-apagar" role="alert">
            <span>
              {lancamentos === 0
                ? `Nenhum lançamento usa este grupo. Apagar?`
                : lancamentos === 1
                  ? `O lançamento deste grupo vai para ${destino}. Apagar?`
                  : `Os ${lancamentos} lançamentos deste grupo vão para ${destino}. Apagar?`}
            </span>
            <span className="grupo-acoes">
              <button type="button" className="btn-link perigo" disabled={ocupado} onClick={apagar}>
                {ocupado ? "Apagando…" : "Apagar"}
              </button>
              <button type="button" className="btn-link" disabled={ocupado} onClick={() => (setApagando(false), setErro(null))}>
                Cancelar
              </button>
            </span>
          </div>
        )}
        {erro && <span className="cat-erro">{erro}</span>}
      </div>
      <span className="grupo-uso num">
        {uso?.vezes ? (
          <>
            {uso.vezes}×
            <br />
            {reais(uso.valor)}
          </>
        ) : (
          "sem uso"
        )}
      </span>
    </div>
  );
}

function ItemSugestao({ s, cor, aoCriado }: { s: Sugestao; cor: string; aoCriado: (nome: string, movidos: number) => Promise<void> }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.criarGrupo({ nome: s.detalhe, tipo: "gasto", cor, absorver_detalhe: s.detalhe });
      await aoCriado(r.grupo.nome, r.movidos);
    } catch (e) {
      setErro(msgDe(e));
      setOcupado(false);
    }
  }

  return (
    <li>
      <span className="grupo-texto">
        <b>{s.detalhe}</b>
        <small>
          {vezes(s.lancamentos.length)} nos últimos 90 dias · {reais(s.total)}
        </small>
        {erro && <span className="cat-erro">{erro}</span>}
      </span>
      <button type="button" onClick={criar} disabled={ocupado}>
        {ocupado ? "Criando…" : "Criar"}
      </button>
    </li>
  );
}

function NaoConta({ titulo, itens }: { titulo: string; itens: [string, string, string][] }) {
  return (
    <div className="grupo-naoconta">
      <span className="rotulo-campo">{titulo}</span>
      <ul>
        {itens.map(([k, nome, texto]) => (
          <li key={k + titulo}>
            <i className="grupo-sw tracejado" aria-hidden="true" />
            <span className="grupo-texto">
              <b>{nome}</b>
              <small>{texto}</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
