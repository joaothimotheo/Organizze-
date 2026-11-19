import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, idsReserva, SemSessao, type Brutos, type EstadoSync, type Grupo, type Movimentacao, type VisaoGeral as Visao } from "../api";
import {
  fechamento,
  fraseFechamento,
  fraseNaoComecou,
  fraseSobra,
  lerPeriodo,
  mesesDaBarra,
  mesesDoPeriodo,
  mesFinal,
  origens,
  proximasContas,
  reservaResumo,
  semOrigem,
  sobraDoPeriodo,
  sobraPorMes,
} from "../analises";
import { gastoPorParte } from "../gastos";
import { addMes, data, hojeISO, nomeCategoria, numero, reais } from "../formato";

const compDe = (m: Movimentacao) => m.competencia ?? m.data.slice(0, 7);
const semGrupo = (c: string) => !c || c === "a_classificar";

/** Próximo vencimento a partir do último informado pelo banco. */
function proximoVencimento(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const hoje = new Date().toISOString().slice(0, 10);
  let v = iso.slice(0, 10);
  for (let i = 0; i < 3 && v < hoje; i++) v = `${addMes(v.slice(0, 7), 1)}-${v.slice(8, 10)}`;
  return v;
}

// ---------- Agora: saldo, fatura e patrimônio ----------

/** Saldo da conta e cartão principal, pelo banco (sincronização) ou pelo último extrato. */
/** `reservas`: contas marcadas como reserva de emergência (ficam fora do "saldo na conta"). */
export function situacaoAgora(visao: Visao, sync: EstadoSync | null, reservas: Set<string> = new Set()) {
  const contas = sync?.ultima_ok?.contas ?? [];
  const ehReserva = (c: { conta_id?: string }) => !!c.conta_id && reservas.has(c.conta_id);
  const correntes = contas.filter((c) => c.tipo === "corrente" && c.saldo != null && !ehReserva(c));
  const contasReserva = contas.filter((c) => c.tipo === "corrente" && c.saldo != null && ehReserva(c));
  const reserva = contasReserva.length ? contasReserva.reduce((a, c) => a + (c.saldo ?? 0), 0) : null;
  const cartoes = contas.filter((c) => c.tipo === "cartao" && ((c.limite ?? 0) > 0 || (c.saldo ?? 0) > 0)).sort((a, b) => (b.limite ?? 0) - (a.limite ?? 0));
  const pat = visao.indicadores.patrimonio;
  const quando = sync?.ultima_ok ? new Date(sync.ultima_ok.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
  const saldo = correntes.length ? correntes.reduce((a, c) => a + (c.saldo ?? 0), 0) : (pat && pat.falta.indexOf("saldos de conta") < 0 ? pat.contas : null);
  const cartao = cartoes[0];
  const usoPct = cartao?.limite ? Math.min(100, ((cartao.limite_usado ?? 0) / cartao.limite) * 100) : null;
  const vence = proximoVencimento(cartao?.vencimento);
  return { correntes, cartoes, pat, quando, saldo, cartao, usoPct, vence, contasReserva, reserva };
}

function Agora({ visao, sync, reservas }: { visao: Visao; sync: EstadoSync | null; reservas: Set<string> }) {
  const { correntes, cartoes, pat, quando, saldo, cartao, usoPct, vence, contasReserva, reserva } = situacaoAgora(visao, sync, reservas);

  return (
    <section className={"agora" + (reserva !== null ? " quatro" : "")} aria-label="Situação agora">
      <div className="agora-item">
        <span className="rot">Saldo na conta</span>
        <strong className={"num grande" + (saldo !== null && saldo < 0 ? " neg" : "")}>{saldo === null ? "Sem dados" : reais(saldo)}</strong>
        <span className="nota">
          {correntes.length ? `${correntes.map((c) => c.conta).join(", ")} · atualizado em ${quando}` : saldo === null ? "Sincronize o banco ou envie um extrato" : "Pelo último extrato enviado"}
        </span>
      </div>
      {reserva !== null && (
        <div className="agora-item">
          <span className="rot">Reserva de emergência</span>
          <strong className="num grande">{reais(reserva)}</strong>
          <span className="nota">{`${contasReserva.map((c) => c.instituicao || c.conta).join(", ")} · fora do saldo do dia a dia, dentro do patrimônio`}</span>
        </div>
      )}
      <div className="agora-item">
        <span className="rot">Fatura aberta do cartão</span>
        <strong className="num grande">{cartao ? reais(cartao.saldo ?? 0) : "Sem dados"}</strong>
        {usoPct !== null && (
          <div className="medidor" role="img" aria-label={`${numero(usoPct)}% do limite usado`}>
            <i style={{ width: `${usoPct}%` }} className={usoPct > 80 ? "alto" : ""} />
          </div>
        )}
        <span className="nota">
          {cartao
            ? [usoPct !== null && `${numero(Math.round(usoPct))}% do limite de ${reais(cartao.limite ?? 0)} em uso`, vence && `vence em ${data(vence)}`].filter(Boolean).join(", ")
            : "Aparece quando o cartão estiver conectado"}
          {cartoes.length > 1 && ` (+${cartoes.length - 1} cartão)`}
        </span>
      </div>
      <div className="agora-item">
        <span className="rot">Patrimônio</span>
        <strong className={"num grande" + (pat && pat.valor < 0 ? " neg" : "")}>{pat ? reais(pat.valor) : "Sem dados"}</strong>
        <span className="nota">
          {pat ? `Conta ${reais(pat.contas)} + investimentos ${reais(pat.investimentos)} − dívidas ${reais(pat.dividas)}` : "Precisa do saldo da conta ou das dívidas"}
        </span>
      </div>
    </section>
  );
}

// ---------- Período escolhido ----------

/** Nome e cor de um grupo. Antes de migrar, o nome da categoria antiga e cor nenhuma. */
function infoGrupo(brutos: Brutos) {
  const migrado = brutos.categoriasMigradas;
  const porId = new Map((brutos.categorias as unknown as Grupo[]).map((g) => [g.id, g]));
  return (id: string): { nome: string; cor: string | null; tipo?: string } => {
    const g = porId.get(id);
    return migrado ? { nome: g?.nome ?? nomeCategoria(id), cor: g?.cor ?? null, tipo: g?.tipo } : { nome: nomeCategoria(id), cor: null };
  };
}

const corDe = (cor: string | null) => (cor ? `var(--${cor})` : "var(--ink-3)");

function Cartao({ titulo, link, rotuloLink, children }: { titulo: string; link: string; rotuloLink: string; children: ReactNode }) {
  return (
    <section className="panel ini-cartao" aria-label={titulo}>
      <div className="ini-cab">
        <h2>{titulo}</h2>
        <a className="btn-link" href={link}>
          {rotuloLink}
        </a>
      </div>
      {children}
    </section>
  );
}

// ---------- Sobrou até agora ----------

function Sobra({ brutos, meses, ano, mes, hoje }: { brutos: Brutos; meses: string[]; ano: number; mes: number | null; hoje: string }) {
  const mesHoje = hoje.slice(0, 7);
  // O mês de hoje só até hoje, como a pergunta 1 das Análises.
  const t = sobraDoPeriodo(brutos.movimentacoes, meses, hoje, brutos.holerites);
  const sobra = t.sobra;
  const naoComecou = fraseNaoComecou(brutos, meses, hoje);
  const emAndamento = mes ? meses[0] >= mesHoje : String(ano) >= mesHoje.slice(0, 4);
  const titulo = !mes ? "Sobrou no ano" : emAndamento ? "Sobrou até agora" : "Sobrou no mês";
  const vazio = t.entrou < 0.005 && t.saiu < 0.005;
  const pct = t.entrou > 0.004 ? Math.min(100, Math.round((t.saiu / t.entrou) * 100)) : t.saiu > 0.004 ? 100 : 0;
  const comps = new Set(meses);
  const pendentes = brutos.movimentacoes.filter((m) => comps.has(compDe(m)) && m.status === "pendente" && m.natureza === "despesa");
  const pendenteTotal = pendentes.reduce((a, m) => a - m.valor, 0);

  if (naoComecou)
    return (
      <section className="panel ini-sobra" aria-labelledby="t-sobra">
        <h2 id="t-sobra" className="ini-rotulo">
          Ainda não começou
        </h2>
        <p className="nota">{naoComecou}</p>
      </section>
    );

  return (
    <section className="panel ini-sobra" aria-labelledby="t-sobra">
      <h2 id="t-sobra" className="ini-rotulo">
        {titulo}
      </h2>
      <strong className={"num enorme" + (sobra < -0.004 ? " neg" : "")}>{reais(sobra)}</strong>
      <div className="ini-split">
        <div>
          <span>Entrou</span>
          <b className="num">{reais(t.entrou)}</b>
          {t.estimadoPeloHolerite && <small className="nota">Líquido do holerite (o salário ainda não apareceu na conta)</small>}
        </div>
        <div>
          <span>Saiu</span>
          <b className="num">{reais(t.saiu)}</b>
        </div>
      </div>
      {!vazio && (
        <div className="medidor" role="img" aria-label={`${numero(pct)}% do que entrou já saiu`}>
          <i style={{ width: `${pct}%` }} className={pct >= 100 ? "alto" : ""} />
        </div>
      )}
      <p className="nota">
        {vazio
          ? "Nenhuma entrada ou gasto neste período. "
          : t.entrou > 0.004
            ? `${emAndamento ? "Você já gastou" : "Você gastou"} ${numero(Math.round((t.saiu / t.entrou) * 100))}% do que entrou. `
            : "Nenhuma entrada neste período. "}
        Transferências entre suas contas e pagamento de dívidas não entram aqui.
      </p>
      {pendentes.length > 0 && (
        <p className="nota">
          Inclui {reais(pendenteTotal)} em {pendentes.length} {pendentes.length === 1 ? "compra pendente" : "compras pendentes"} da fatura aberta, que ainda pode mudar até o fechamento.
        </p>
      )}
    </section>
  );
}

// ---------- Para onde foi o dinheiro ----------

function ParaOnde({ brutos, meses }: { brutos: Brutos; meses: string[] }) {
  const linhas = useMemo(() => {
    const comps = new Set(meses);
    const info = infoGrupo(brutos);
    return [...gastoPorParte(brutos.movimentacoes.filter((m) => comps.has(compDe(m)))).entries()]
      .filter(([id, v]) => v > 0.004 && !semGrupo(id))
      .map(([id, v]) => ({ id, valor: v, ...info(id) }))
      .filter((g) => g.tipo !== "entrada")
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 5);
  }, [brutos, meses]);
  const maior = linhas[0]?.valor ?? 0;
  return (
    <Cartao titulo="Para onde foi o dinheiro" link="#movimentos/saidas" rotuloLink="Ver gastos">
      {!linhas.length ? (
        <p className="nota">Nenhum gasto neste período.</p>
      ) : (
        <ul className="an-barras ini-barras">
          {linhas.map((g) => (
            <li key={g.id}>
              <a href={`#movimentos/${encodeURIComponent(g.id)}`} aria-label={`Ver os gastos de ${g.nome}`}>
                <span className="an-barras-nome">
                  <i className="mv-sw" style={{ background: corDe(g.cor) }} aria-hidden="true" />
                  <span>{g.nome}</span>
                </span>
                <span className="an-barras-valor">{reais(g.valor)}</span>
                <span className="an-barras-trilho" aria-hidden="true">
                  <i style={{ width: `${maior > 0 ? (g.valor / maior) * 100 : 0}%`, background: corDe(g.cor) }} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

// ---------- De onde veio ----------

function DeOnde({ brutos, meses }: { brutos: Brutos; meses: string[] }) {
  const { linhas, sem } = useMemo(() => {
    const soma = new Map<string, { grupo: string; nome: string; cor: string | null; valor: number }>();
    let sem = 0;
    for (const mes of meses) {
      for (const o of origens(brutos.movimentacoes, brutos.categorias, mes, brutos.holerites)) {
        const atual = soma.get(o.grupo);
        if (atual) atual.valor += o.valor;
        else soma.set(o.grupo, { ...o });
      }
      sem += semOrigem(brutos.movimentacoes, mes);
    }
    return { linhas: [...soma.values()].sort((a, b) => b.valor - a.valor), sem };
  }, [brutos, meses]);
  return (
    <Cartao titulo="De onde veio" link="#movimentos/entradas" rotuloLink="Ver entradas">
      {!linhas.length && sem < 0.005 ? (
        <p className="nota">Nenhuma entrada neste período.</p>
      ) : (
        <ul className="ini-lista">
          {linhas.map((o) => (
            <li key={o.grupo}>
              <i className="mv-sw" style={{ background: corDe(o.cor) }} aria-hidden="true" />
              <span className="ini-nome">{o.nome}</span>
              <span className="ini-valor pos">{reais(o.valor)}</span>
            </li>
          ))}
          {sem > 0.004 && (
            <li>
              <i className="mv-sw" style={{ background: "var(--warn)" }} aria-hidden="true" />
              <a className="ini-nome" href="#movimentos/pendentes">
                Sem origem ainda
              </a>
              <span className="ini-valor">{reais(sem)}</span>
            </li>
          )}
        </ul>
      )}
    </Cartao>
  );
}

// ---------- Próximas contas ----------

function Proximas({ brutos, hoje }: { brutos: Brutos; hoje: string }) {
  const contas = useMemo(() => proximasContas(brutos, hoje, 3), [brutos, hoje]);
  return (
    <Cartao titulo="Próximas contas" link="#fixas" rotuloLink="Contas fixas">
      {!contas.length ? (
        <p className="nota">Nenhuma conta nos próximos dias.</p>
      ) : (
        <ul className="ini-lista">
          {contas.map((c) => (
            <li key={`${c.tipo}-${c.nome}-${c.data}`}>
              <span className="ini-nome">
                <b>{c.nome}</b>
                <small>
                  {data(c.data)} · {c.tipo === "fixa" ? "conta fixa" : "dívida"}
                  {c.atrasada && <span className="ini-atrasada"> · atrasada</span>}
                </small>
              </span>
              <span className="ini-valor">{reais(c.valor)}</span>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

// ---------- Reserva de emergência ----------

function Reserva({ brutos, saldo, hoje }: { brutos: Brutos; saldo: number | null; hoje: string }) {
  const r = reservaResumo(brutos, saldo, hoje);
  return (
    <Cartao titulo="Reserva de emergência" link="#objetivos" rotuloLink="Objetivos">
      {!r ? (
        <p className="nota">Sincronize o banco para ver o saldo da reserva.</p>
      ) : (
        <>
          <div className="ini-reserva">
            <strong className="num">{reais(r.saldo)}</strong>
            {r.meta !== null && <span>de {reais(r.meta)}</span>}
          </div>
          {r.pct !== null && (
            <div className="medidor" role="img" aria-label={`${numero(r.pct)}% da meta`}>
              <i style={{ width: `${Math.max(0, Math.min(100, r.pct))}%` }} />
            </div>
          )}
          <p className="nota">{[r.pct !== null && `${numero(r.pct)}%.`, r.frase ?? (r.meta === null ? "Sem meta para a reserva ainda." : null)].filter(Boolean).join(" ")}</p>
        </>
      )}
    </Cartao>
  );
}

// ---------- Análise do mês ----------

function AnaliseDoMes({ brutos, ano, mes, hoje }: { brutos: Brutos; ano: number; mes: number | null; hoje: string }) {
  const fim = mesFinal(ano, mes, hoje);
  // Mês atual ou futuro: a frase da pergunta 1; mês passado: a da pergunta 3.
  const comPrevisao = fim >= hoje.slice(0, 7);
  const periodo = lerPeriodo();
  // Só as contas ficam guardadas; a frase é refeita a cada desenho (o modo "esconder valores" muda o texto).
  const r = useMemo(
    () => (comPrevisao ? { fech: fechamento(brutos, fim, hoje) } : { sobra: sobraPorMes(brutos, mesesDoPeriodo(fim, periodo), hoje) }),
    [brutos, fim, hoje, comPrevisao, periodo],
  );
  const frase = r.fech ? fraseFechamento(r.fech) : fraseSobra(r.sobra ?? []);
  return (
    <a className="panel ini-analise" href="#analises">
      <span className="ini-analise-texto">
        <b>Análise do mês</b>
        <span>{frase}</span>
      </span>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

export default function VisaoGeral({ visao, brutos }: { visao: Visao; brutos: Brutos; aoMudar: () => Promise<void> }) {
  const [sync, setSync] = useState<EstadoSync | null>(null);

  useEffect(() => {
    api.sincronizacao().then(setSync, (e) => {
      if (!(e instanceof SemSessao)) setSync(null);
    });
  }, [visao]);

  const { ano, mes } = visao.periodo;
  const hoje = hojeISO();
  const meses = useMemo(() => mesesDaBarra(ano, mes), [ano, mes]);
  const reservas = useMemo(() => idsReserva(brutos.contas), [brutos.contas]);
  const { reserva } = situacaoAgora(visao, sync, reservas);
  const temReserva = reservas.size > 0 || brutos.metas.some((m) => m.usar_reserva);

  return (
    <>
      <Agora visao={visao} sync={sync} reservas={reservas} />
      <Sobra brutos={brutos} meses={meses} ano={ano} mes={mes} hoje={hoje} />
      <div className="ini-grade">
        <ParaOnde brutos={brutos} meses={meses} />
        <DeOnde brutos={brutos} meses={meses} />
        <Proximas brutos={brutos} hoje={hoje} />
        {temReserva && <Reserva brutos={brutos} saldo={reserva} hoje={hoje} />}
      </div>
      <AnaliseDoMes brutos={brutos} ano={ano} mes={mes} hoje={hoje} />
    </>
  );
}
