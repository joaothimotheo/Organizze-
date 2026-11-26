import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, idsReserva, SemSessao, type Brutos, type EstadoSync, type Grupo, type Movimentacao, type VisaoGeral as Visao } from "../api";
import {
  faturaDoMes,
  faturasDoBanco,
  melhorDiaDeCompra,
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
import { GraficoPrevisao } from "../componentes/Graficos";
import { previsao } from "../previsao";
import { categoriasLimitaveis, limitesDoMes, type LinhaLimite } from "../orcamento";
import { addMes, data, hojeISO, lerValor, MESES, nomeCategoria, numero, reais } from "../formato";

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

function Agora({ visao, brutos, sync, reservas, hoje }: { visao: Visao; brutos: Brutos; sync: EstadoSync | null; reservas: Set<string>; hoje: string }) {
  const { correntes, cartoes, pat, quando, saldo, cartao, usoPct, vence, contasReserva, reserva } = situacaoAgora(visao, sync, reservas);
  const mesHoje = hoje.slice(0, 7);
  const fatura = useMemo(() => faturaDoMes(brutos, mesHoje), [brutos, mesHoje]);
  const banco = useMemo(() => faturasDoBanco(cartao?.faturas, brutos.movimentacoes, cartao?.conta_id, hoje), [cartao, brutos.movimentacoes, hoje]);
  const ultima = banco?.ultima;
  const melhor = melhorDiaDeCompra(banco?.proximoFechamento, vence, hoje);
  // Diferença entre o banco e os nossos lançamentos daquela fatura (compras que mudaram de fatura, por exemplo).
  const diferenca = ultima && Math.abs(ultima.total - ultima.lancamentos) >= 1 ? ultima.lancamentos : null;
  const comFatura = fatura !== null || !!cartao;
  const itens = 3 + (reserva !== null ? 1 : 0) + (comFatura ? 1 : 0);
  const classe = itens === 5 ? " cinco" : itens === 4 ? " quatro" : "";

  return (
    <section className={"agora" + classe} aria-label="Situação agora">
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
      {comFatura && (
        <div className="agora-item">
          <span className="rot">
            Fatura atual
            {melhor ? ` (fecha ${data(banco!.proximoFechamento).slice(0, 5)}, vence ${data(melhor.venceAtual).slice(0, 5)})` : vence ? ` (vence ${data(vence).slice(0, 5)})` : ""}
          </span>
          <strong className="num grande">{reais(fatura?.total ?? 0)}</strong>
          <span className="nota">
            {!fatura
              ? "Nenhuma compra nesta fatura ainda"
              : [
                  fatura.cartoes.length > 1 ? fatura.cartoes.map((c) => `${c.nome} ${reais(c.total)}`).join(" + ") : "Só as compras desta fatura, sem as parcelas futuras",
                  fatura.pendentes > 0.004 &&
                    (fatura.pendentes >= fatura.total - 0.004 ? "ainda pode mudar até o fechamento" : `inclui ${reais(fatura.pendentes)} pendente`),
                ]
                  .filter(Boolean)
                  .join(", ")}
          </span>
          {melhor && (
            <span className="nota ini-melhor-dia">
              {melhor.agora
                ? `Boa época para compras no cartão: o que comprar agora só vence em ${data(melhor.venceAtual).slice(0, 5)}`
                : `Melhor dia de compra: ${data(melhor.dia).slice(0, 5)} (a partir dele, só vence em ${data(melhor.vence).slice(0, 5)})`}
            </span>
          )}
          {ultima && (
            <span className="nota">
              {ultima.total < -0.004
                ? `Última fatura do banco: crédito de ${reais(-ultima.total)} a seu favor`
                : `Fatura de ${data(ultima.vencimento).slice(0, 5)} (valor do banco): ${reais(ultima.total)}, ${ultima.paga ? "paga" : "não paga ainda"}`}
              {diferenca !== null && ultima.total > -0.004 && `. Pelos lançamentos daria ${reais(diferenca)} (diferença de ${reais(Math.abs(ultima.total - diferenca))})`}
            </span>
          )}
        </div>
      )}
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

// ---------- Até o próximo salário ----------

/**
 * O que vai sair da conta para pagar o cartão principal: a fatura fechada ainda não paga (valor do
 * banco) e a atual (nossa estimativa), cada uma no seu vencimento.
 */
function faturasAPagar(visao: Visao, sync: EstadoSync | null, reservas: Set<string>, brutos: Brutos, hoje: string) {
  const { cartao, vence } = situacaoAgora(visao, sync, reservas);
  if (!cartao) return [];
  const atual = faturaDoMes(brutos, hoje.slice(0, 7));
  const banco = faturasDoBanco(cartao.faturas, brutos.movimentacoes, cartao.conta_id, hoje);
  const out: { dia: string; valor: number; nome: string }[] = [];
  let diaAtual = vence;
  if (banco && !banco.ultima.paga && banco.ultima.vencimento >= hoje) {
    out.push({ dia: banco.ultima.vencimento, valor: banco.ultima.total, nome: "Fatura fechada do cartão" });
    // A atual vence no mês seguinte ao da fechada.
    diaAtual = `${addMes(banco.ultima.vencimento.slice(0, 7), 1)}-${banco.ultima.vencimento.slice(8, 10)}`;
  }
  if (atual && diaAtual) out.push({ dia: diaAtual, valor: atual.total, nome: "Fatura do cartão" });
  return out;
}

function AteOSalario({ visao, brutos, sync, reservas, hoje }: { visao: Visao; brutos: Brutos; sync: EstadoSync | null; reservas: Set<string>; hoje: string }) {
  const { saldo } = situacaoAgora(visao, sync, reservas);
  const p = useMemo(
    () => (saldo === null ? null : previsao(brutos, { saldo, faturas: faturasAPagar(visao, sync, reservas, brutos, hoje) }, hoje)),
    [saldo, brutos, visao, sync, reservas, hoje],
  );
  if (!p) return null;
  const dm = (d: string) => data(d).slice(0, 5);
  const titulo = p.salario ? `Até o salário de ${dm(p.salario.dia)}` : `Até o fim do mês`;
  const proximos = p.eventos.filter((e) => e.dia <= p.ate);
  const saidas = proximos.filter((e) => e.valor < 0).reduce((s, e) => s - e.valor, 0);
  const ritmoNegativo = !p.falta && p.diaADia > p.porDia + 0.004 ? p.negativo : null;
  return (
    <section className="panel ini-previsao" aria-labelledby="t-previsao">
      <h2 id="t-previsao" className="ini-rotulo">
        {titulo}
      </h2>
      {p.falta ? (
        <>
          <strong className="num enorme neg">Vai faltar {reais(p.falta.valor)}</strong>
          <p className="nota">Em {dm(p.falta.dia)} o saldo da conta fica negativo, mesmo sem gastar nada no dia a dia. Veja abaixo o que vence até lá.</p>
        </>
      ) : (
        <>
          <strong className="num enorme">
            {reais(p.porDia)} <span className="ini-por-dia">por dia</span>
          </strong>
          <p className="nota">
            É quanto dá para gastar por dia até {dm(p.ate)} sem o saldo da conta ficar negativo, já separando {reais(saidas)} de contas e faturas que vencem até lá
            {p.salario ? ` e contando o salário de ${reais(p.salario.valor)}` : ""}.
            {p.aperto && p.aperto.dia !== p.ate && ` O dia mais apertado é ${dm(p.aperto.dia)}.`}
          </p>
        </>
      )}
      {p.diaADia > 0.004 && (
        <p className={"nota" + (ritmoNegativo ? " ini-alerta" : "")}>
          Nos últimos 60 dias você gastou em média {reais(p.diaADia)} por dia na conta
          {ritmoNegativo ? `: nesse ritmo, o saldo fica negativo em ${dm(ritmoNegativo)}.` : "."}
        </p>
      )}
      <h3 className="ini-subtitulo">Saldo previsto da conta, dia a dia</h3>
      <GraficoPrevisao serie={p.serie} eventos={p.eventos} />
      {proximos.length > 0 && (
        <ul className="ini-lista">
          {proximos.slice(0, 6).map((e) => (
            <li key={`${e.dia}-${e.nome}-${e.valor}`}>
              <span className="ini-nome">
                <b>{e.nome}</b>
                <small>{dm(e.dia)}</small>
              </span>
              <span className={"ini-valor" + (e.valor > 0 ? " pos" : "")}>
                {e.valor > 0 ? "+" : "−"}
                {reais(Math.abs(e.valor))}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="nota">
        Parte do saldo de hoje da conta ({reais(p.saldoHoje)}, sem a reserva).
        {p.salario && (p.salario.pelo === "holerite" ? " Salário pela data e líquido do holerite." : " Salário previsto pelos últimos que caíram na conta.")} A fatura do cartão é a estimativa de hoje e
        ainda cresce com as compras até o fechamento. A linha do gráfico desconta o seu gasto médio por dia.
      </p>
    </section>
  );
}

// ---------- Limites de gasto ----------

const COR_SITUACAO: Record<LinhaLimite["situacao"], string> = { ok: "var(--accent)", vai_passar: "var(--warn)", perto: "var(--warn)", passou: "var(--bad)" };

function fraseLimite(l: LinhaLimite): string {
  if (l.situacao === "passou") return `Passou ${reais(-l.restante)} do limite`;
  if (l.situacao === "vai_passar" && l.previsto !== null) return `Restam ${reais(l.restante)}. No ritmo atual, chega a ${reais(l.previsto)} no fim do mês`;
  return `Restam ${reais(l.restante)}`;
}

function EditarLimites({ brutos, mes, aoSalvar, aoFechar }: { brutos: Brutos; mes: string; aoSalvar: () => Promise<void>; aoFechar: () => void }) {
  const cats = useMemo(() => categoriasLimitaveis(brutos, mes), [brutos, mes]);
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(cats.map((c) => [c.categoria, c.limite !== null ? numero(c.limite) : ""])),
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    const mudou: [string, number | null][] = [];
    for (const c of cats) {
      const txt = valores[c.categoria] ?? "";
      const v = txt.trim() ? lerValor(txt) : null;
      if (txt.trim() && (v === null || v < 0)) {
        setErro(`O limite de ${c.nome} não é um valor válido.`);
        return;
      }
      const novo = v && v > 0 ? v : null;
      if (novo !== c.limite) mudou.push([c.categoria, novo]);
    }
    setSalvando(true);
    setErro(null);
    try {
      for (const [cat, v] of mudou) await api.definirLimite(cat, v);
      await aoSalvar();
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui salvar os limites.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="lim-editar">
      <p className="nota">Deixe em branco a categoria que não quer limitar. A média é a dos 3 meses anteriores.</p>
      {!cats.length && <p className="nota">Nenhuma categoria com gasto nos últimos meses.</p>}
      <ul className="lim-campos">
        {cats.map((c) => (
          <li key={c.categoria}>
            <label htmlFor={`lim-${c.categoria}`}>
              <i className="mv-sw" style={{ background: corDe(c.cor) }} aria-hidden="true" />
              <span>
                <b>{c.nome}</b>
                <small>{c.media > 0.004 ? `média de ${reais(c.media)} por mês` : "sem gasto nos últimos meses"}</small>
              </span>
            </label>
            <input
              id={`lim-${c.categoria}`}
              type="text"
              inputMode="decimal"
              placeholder={c.sugestao !== null ? numero(c.sugestao) : "R$"}
              value={valores[c.categoria] ?? ""}
              onChange={(e) => setValores((v) => ({ ...v, [c.categoria]: e.target.value }))}
            />
          </li>
        ))}
      </ul>
      {erro && <p className="nota ini-alerta">{erro}</p>}
      <div className="lim-acoes">
        <button type="button" className="primary" disabled={salvando} onClick={salvar}>
          {salvando ? "Salvando…" : "Salvar limites"}
        </button>
        <button type="button" disabled={salvando} onClick={aoFechar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function Limites({ brutos, mes, hoje, aoMudar }: { brutos: Brutos; mes: string; hoje: string; aoMudar: () => Promise<void> }) {
  const [editando, setEditando] = useState(false);
  const linhas = useMemo(() => limitesDoMes(brutos, mes, hoje), [brutos, mes, hoje]);
  const nomeMes = MESES[Number(mes.slice(5, 7)) - 1];
  return (
    <section className="panel ini-cartao lim" aria-labelledby="t-limites">
      <div className="ini-cab">
        <h2 id="t-limites">Limites de gasto em {nomeMes}</h2>
        {!editando && (
          <button type="button" className="btn-link" onClick={() => setEditando(true)}>
            {linhas.length ? "Editar limites" : "Definir limites"}
          </button>
        )}
      </div>
      {editando ? (
        <EditarLimites brutos={brutos} mes={mes} aoSalvar={aoMudar} aoFechar={() => setEditando(false)} />
      ) : !linhas.length ? (
        <p className="nota">Escolha quanto quer gastar no máximo em cada categoria por mês. Mostro aqui quanto já foi e aviso no celular ao chegar em 80% e ao passar do limite.</p>
      ) : (
        <ul className="lim-lista">
          {linhas.map((l) => (
            <li key={l.categoria}>
              <div className="lim-linha">
                <a className="lim-nome" href={`#movimentos/${encodeURIComponent(l.categoria)}`}>
                  <i className="mv-sw" style={{ background: corDe(l.cor) }} aria-hidden="true" />
                  {l.nome}
                </a>
                <span className="lim-valor">
                  <b>{reais(l.gasto)}</b> de {reais(l.limite)}
                </span>
              </div>
              <div className="medidor" role="img" aria-label={`${l.pct}% do limite de ${l.nome}`}>
                <i style={{ width: `${Math.min(100, l.pct)}%`, background: COR_SITUACAO[l.situacao] }} />
              </div>
              <small className={"lim-frase" + (l.situacao === "ok" ? "" : l.situacao === "passou" ? " lim-passou" : " lim-perto")}>
                {l.pct}% · {fraseLimite(l)}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
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

export default function VisaoGeral({ visao, brutos, aoMudar }: { visao: Visao; brutos: Brutos; aoMudar: () => Promise<void> }) {
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
  // Limites: o mês escolhido na barra; ano inteiro ou mês que ainda não chegou, o mês de hoje.
  const mesEscolhido = mes ? `${ano}-${String(mes).padStart(2, "0")}` : null;
  const mesDosLimites = mesEscolhido && mesEscolhido <= hoje.slice(0, 7) ? mesEscolhido : hoje.slice(0, 7);
  const temReserva = reservas.size > 0 || brutos.metas.some((m) => m.usar_reserva);

  return (
    <>
      <Agora visao={visao} brutos={brutos} sync={sync} reservas={reservas} hoje={hoje} />
      <Sobra brutos={brutos} meses={meses} ano={ano} mes={mes} hoje={hoje} />
      <AteOSalario visao={visao} brutos={brutos} sync={sync} reservas={reservas} hoje={hoje} />
      <Limites brutos={brutos} mes={mesDosLimites} hoje={hoje} aoMudar={aoMudar} />
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
