import { useCallback, useEffect, useMemo, useState } from "react";
import type { Brutos, Grupo, Movimentacao } from "../api";
import DetalhesLancamento from "../componentes/DetalhesLancamento";
import { Vazio } from "../componentes/Indicador";
import JanelaCategoria from "../componentes/JanelaCategoria";
import ModoRapido from "../componentes/ModoRapido";
import { tituloDe } from "../componentes/NomeLancamento";
import { data, nomeCategoria, reais } from "../formato";
import { ehEntrada, naoConta, nomeNatureza, semCategoria } from "../grupos";
import { doPeriodo, filaRapida, filtrar, FILTRO_VAZIO, partesDe, pendente, porDia, resumo, rotaMovimentos, type Aba, type Filtro } from "../movimentos";
import { nomeConta } from "./Enviar";
import { linkMesAMes } from "./Gastos";

const ABAS: [Aba, string][] = [
  ["entradas", "Entradas"],
  ["saidas", "Saídas"],
  ["tudo", "Tudo"],
];

const VALORES: [Filtro["valorMin"], string][] = [
  [0, "Qualquer valor"],
  [50, "Acima de R$ 50"],
  [100, "Acima de R$ 100"],
  [500, "Acima de R$ 500"],
];

const LIGADO_SEM_NOME: Record<string, string> = { divida: "uma dívida", pessoa: "uma pessoa", fixa: "uma conta fixa" };

/** Janela aberta por cima da lista. */
type Aberta = { tipo: "categoria"; id: string } | { tipo: "detalhes"; id: string } | { tipo: "rapido"; fila: string[] } | null;

/** Muda o endereço (a tela relê aba e grupo dele); o mesmo endereço não faz nada. */
function ir(hash: string) {
  if (location.hash !== hash) location.hash = hash;
}

/**
 * Tela Movimentos: entradas e saídas do período da barra do topo, com resumo por grupo, busca, filtros
 * e lista por dia. O nome abre os detalhes (renomear, dividir, ligar); a pílula de categoria abre a janela
 * de categoria; "Organizar um por um" abre o modo rápido com os pendentes da lista.
 */
export default function Movimentos({
  brutos,
  ano,
  mes,
  endereco,
  aoMudar,
  avisar,
}: {
  brutos: Brutos;
  ano: number;
  mes: number | null;
  /** O que vem depois de "#movimentos/" ("entradas", "pendentes", o id de um grupo…). */
  endereco: string;
  aoMudar: () => Promise<void>;
  /** Aviso curto depois de salvar numa janela. */
  avisar?: (texto: string) => void;
}) {
  // Antes de migrar as categorias não têm tipo nem cor; servem só para entender o endereço.
  const grupos = brutos.categorias as unknown as Grupo[];
  const rotaToda = useMemo(() => rotaMovimentos(endereco, grupos), [endereco, grupos]);
  const rota = rotaToda.filtro;
  const aba = rota.aba ?? "saidas";
  const grupo = rota.grupo ?? null;
  // "#movimentos/lancamento/<id>" (do Início ou do mês a mês) abre os detalhes daquele lançamento.
  const abrirPeloEndereco = rotaToda.abrir;

  const [busca, setBusca] = useState("");
  const [conta, setConta] = useState<string | null>(null);
  const [valorMin, setValorMin] = useState<Filtro["valorMin"]>(0);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [soPendentes, setSoPendentes] = useState(!!rota.soPendentes);
  const [aberta, setAberta] = useState<Aberta>(null);

  // Cada endereço novo (aba, grupo, pendentes) traz o seu "só os sem categoria"; busca e filtros continuam.
  useEffect(() => {
    setSoPendentes(!!rotaMovimentos(endereco, []).filtro.soPendentes);
  }, [endereco]);

  useEffect(() => {
    if (!abrirPeloEndereco) return;
    if (brutos.movimentacoes.some((m) => m.id === abrirPeloEndereco)) setAberta({ tipo: "detalhes", id: abrirPeloEndereco });
    else {
      // Link para um lançamento que não existe (apagado ou endereço velho): sem janela.
      ir("#movimentos/tudo");
      avisar?.("Lançamento não encontrado.");
    }
    // Só quando o endereço muda; a recarga dos dados depois de salvar não reabre nada.
  }, [abrirPeloEndereco]);

  const contas = useMemo(() => new Map(brutos.contas.map((c) => [c.id, nomeConta(c)])), [brutos.contas]);
  const nomeDaConta = useMemo(() => (id?: string | null) => (!id || id === "dinheiro" ? "Dinheiro" : (contas.get(id) ?? id)), [contas]);
  const grupoPorId = useMemo(() => new Map(grupos.map((g) => [g.id, g])), [grupos]);

  const doMes = useMemo(() => doPeriodo(brutos.movimentacoes, ano, mes), [brutos.movimentacoes, ano, mes]);
  const daAba = (a: Aba) => filtrar(doMes, { ...FILTRO_VAZIO, aba: a }, nomeDaConta);
  const pendentesPorAba = Object.fromEntries(ABAS.map(([a]) => [a, daAba(a).filter(pendente).length])) as Record<Aba, number>;
  const listaDaAba = daAba(aba);
  // Inclui os divididos com parte sem grupo, que ficam fora da fila do modo rápido.
  const nPendentes = pendentesPorAba[aba];
  const dias = porDia(filtrar(doMes, { aba, busca, conta, valorMin, grupo, soPendentes }, nomeDaConta));
  const chips = aba === "tudo" ? [] : resumo(doMes, grupos, aba === "entradas" ? "entrada" : "gasto");
  const fila = filaRapida(listaDaAba);

  const nFiltros = (conta ? 1 : 0) + (valorMin ? 1 : 0);
  const nomeGrupo = grupo ? (grupoPorId.get(grupo)?.nome ?? nomeCategoria(grupo)) : null;

  /** Tira o "só os sem categoria"; vindo de #movimentos/pendentes, volta para a aba Tudo sem o filtro. */
  function verTodos() {
    setSoPendentes(false);
    if (rota.soPendentes) ir("#movimentos/tudo");
  }

  // Lançamento dividido nunca abre a janela de categoria (ela desfaria a divisão): vai aos detalhes.
  const trocar = (m: Movimentacao) => setAberta({ tipo: partesDe(m).length > 1 ? "detalhes" : "categoria", id: m.id });
  const abrir = (m: Movimentacao) => setAberta({ tipo: "detalhes", id: m.id });
  // Aberta pelo endereço: ao fechar, o endereço volta à aba Tudo (o mesmo link pode abrir de novo).
  const fechar = useCallback(() => {
    setAberta(null);
    if (abrirPeloEndereco) ir("#movimentos/tudo");
  }, [abrirPeloEndereco]);
  const movAberto = aberta && aberta.tipo !== "rapido" ? brutos.movimentacoes.find((m) => m.id === aberta.id) : undefined;

  /** Depois de salvar numa janela: recarrega, fecha e avisa. */
  async function salvo(texto?: string) {
    try {
      await aoMudar();
    } catch {
      fechar();
      avisar?.("Salvo, mas não consegui recarregar; atualize a página.");
      return;
    }
    fechar();
    if (texto) avisar?.(texto);
  }

  function nomeLigado(v: NonNullable<Movimentacao["vinculo"]>): string {
    if (v.tipo === "divida") {
      const d = brutos.dividas.find((x) => x.id === v.id);
      if (d) return d.nome || d.credor;
    } else if (v.tipo === "pessoa") {
      const e = brutos.emprestimos.find((x) => x.id === v.id);
      if (e) return e.pessoa;
    } else if (v.tipo === "fixa") {
      const f = brutos.fixas.find((x) => x.id === v.id);
      if (f) return f.nome;
    }
    return LIGADO_SEM_NOME[v.tipo] ?? "outro registro";
  }

  const cor = (cat: string) => grupoPorId.get(cat)?.cor;
  const amostra = (cat: string) => {
    const c = cor(cat);
    return c ? <i className="mv-sw" style={{ background: `var(--${c})` }} aria-hidden="true" /> : null;
  };

  function pilulas(m: Movimentacao) {
    if (naoConta(m))
      return (
        <button type="button" className="mv-pilula neutro" onClick={() => trocar(m)} aria-label={`${nomeNatureza(m.natureza)}, não conta no mês. Trocar`}>
          {nomeNatureza(m.natureza)} · não conta
        </button>
      );
    // Dividido: cada parte abre os detalhes (uma categoria escolhida por um toque desfaria a divisão);
    // a parte ainda sem grupo aparece em âmbar.
    const partes = partesDe(m);
    if (partes.length > 1)
      return partes.map((p, i) =>
        p.categoria === "a_classificar" ? (
          <button key={i} type="button" className="mv-pilula falta" onClick={() => abrir(m)} title="Abrir detalhes">
            {ehEntrada(m) ? "De onde veio?" : "Escolher categoria"} <span className="num">{reais(Math.abs(p.valor))}</span>
          </button>
        ) : (
          <button key={i} type="button" className="mv-pilula" onClick={() => abrir(m)} title="Abrir detalhes">
            {amostra(p.categoria)}
            {nomeCategoria(p.categoria)} <span className="num">{reais(Math.abs(p.valor))}</span>
          </button>
        ),
      );
    if (semCategoria(m))
      return (
        <button type="button" className="mv-pilula falta" onClick={() => trocar(m)}>
          {ehEntrada(m) ? "De onde veio?" : "Escolher categoria"}
        </button>
      );
    return (
      <button type="button" className="mv-pilula" onClick={() => trocar(m)} aria-label={`Categoria: ${nomeCategoria(m.categoria)}. Trocar`}>
        {amostra(m.categoria!)}
        {nomeCategoria(m.categoria)}
      </button>
    );
  }

  function linha(m: Movimentacao) {
    const entrada = ehEntrada(m);
    const conta = nomeDaConta(m.conta_id);
    const sub = [conta, m.nome ? m.descricao : null, m.parcela ? `parcela ${m.parcela.replace(/^0/, "").replace("/0", "/")}` : null].filter(Boolean).join(" · ");
    return (
      <div key={m.id} className={"mv-linha" + (naoConta(m) ? " muted" : "")}>
        <button type="button" className="mv-abrir" onClick={() => abrir(m)} title="Abrir detalhes">
          <b>{tituloDe(m)}</b>
          <small>{sub}</small>
        </button>
        <div className="mv-cat">
          {pilulas(m)}
          {m.quem && (
            <span className="mv-quem">
              {entrada ? "de" : "para"} {m.quem}
            </span>
          )}
          {m.vinculo && <span className="mv-ligado">Ligado a {nomeLigado(m.vinculo)}</span>}
        </div>
        <div className={"mv-valor num" + (entrada ? " pos" : "")}>{reais(m.valor)}</div>
      </div>
    );
  }

  return (
    <div className="movimentos">
      <div className="mv-abas" role="group" aria-label="Tipo">
        {ABAS.map(([a, nome]) => (
          <button key={a} type="button" aria-pressed={aba === a} onClick={() => ir(`#movimentos/${a}`)}>
            {nome}
            {pendentesPorAba[a] > 0 && <span className="mv-cnt">· {pendentesPorAba[a]} a organizar</span>}
          </button>
        ))}
      </div>

      {chips.length > 0 && (
        <div className="mv-chips" role="group" aria-label={aba === "entradas" ? "Entradas por origem" : "Saídas por grupo"}>
          {chips.map(({ grupo: g, total }) => (
            <button
              key={g.id}
              type="button"
              className="mv-chip"
              aria-pressed={grupo === g.id}
              onClick={() => ir(grupo === g.id ? `#movimentos/${aba}` : `#movimentos/${encodeURIComponent(g.id)}`)}
            >
              <small>
                {amostra(g.id)}
                {g.nome}
              </small>
              <b className="num">{reais(total)}</b>
            </button>
          ))}
        </div>
      )}

      <div className="mv-busca-linha">
        <label className="mv-busca">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input type="search" aria-label="Buscar lançamentos" placeholder="Buscar por nome, banco, pessoa ou conta" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <button type="button" aria-expanded={filtrosAbertos} onClick={() => setFiltrosAbertos((v) => !v)}>
          Filtros{nFiltros ? ` (${nFiltros})` : ""}
        </button>
      </div>

      {filtrosAbertos && (
        <div className="panel mv-filtros">
          <span className="rotulo-campo" id="mv-f-conta">
            Conta
          </span>
          <div className="mv-opcoes" role="group" aria-labelledby="mv-f-conta">
            {[...brutos.contas.map((c) => [c.id, nomeConta(c)] as const), ["dinheiro", "Dinheiro"] as const].map(([id, nome]) => (
              <button key={id} type="button" aria-pressed={conta === id} onClick={() => setConta(conta === id ? null : id)}>
                {nome}
              </button>
            ))}
          </div>
          <span className="rotulo-campo" id="mv-f-valor">
            Valor
          </span>
          <div className="mv-opcoes" role="group" aria-labelledby="mv-f-valor">
            {VALORES.map(([v, nome]) => (
              <button key={v} type="button" aria-pressed={valorMin === v} onClick={() => setValorMin(v)}>
                {nome}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mv-acoes">
        {listaDaAba.length > 0 &&
          (fila.length > 0 ? (
            <button type="button" onClick={() => setAberta({ tipo: "rapido", fila })}>
              Organizar um por um ({fila.length})
            </button>
          ) : nPendentes === 0 ? (
            <span className="pill ok">Tudo organizado nesta lista</span>
          ) : null)}
        {listaDaAba.length > 0 && (nPendentes > 0 || soPendentes) && (
          <label className="check">
            <input type="checkbox" checked={soPendentes} onChange={(e) => (e.target.checked ? setSoPendentes(true) : verTodos())} /> Só os sem categoria
          </label>
        )}
        {nomeGrupo && (
          <button type="button" className="mv-pilula" onClick={() => ir(`#movimentos/${aba}`)} aria-label={`Tirar o filtro ${nomeGrupo}`}>
            {nomeGrupo} ×
          </button>
        )}
        {conta && (
          <button type="button" className="mv-pilula" onClick={() => setConta(null)} aria-label={`Tirar o filtro ${nomeDaConta(conta)}`}>
            {nomeDaConta(conta)} ×
          </button>
        )}
        {valorMin > 0 && (
          <button type="button" className="mv-pilula" onClick={() => setValorMin(0)} aria-label={`Tirar o filtro acima de R$ ${valorMin}`}>
            Acima de R$ {valorMin} ×
          </button>
        )}
        <a className="btn-link mv-mesames" href={linkMesAMes(grupo)}>
          {grupo ? "Ver mês a mês" : "Ver todas as categorias mês a mês"}
        </a>
      </div>

      {listaDaAba.length === 0 ? (
        <Vazio titulo="Nenhum lançamento neste período.">{null}</Vazio>
      ) : soPendentes && nPendentes === 0 ? (
        <Vazio titulo="Nada para organizar neste período.">
          <button type="button" className="btn-link" onClick={verTodos}>
            Ver todos os lançamentos
          </button>
        </Vazio>
      ) : dias.length === 0 ? (
        <Vazio titulo="Nada encontrado. Mude a busca ou tire um filtro.">{null}</Vazio>
      ) : (
        dias.map(({ dia, itens }) => (
          <section key={dia} className="mv-dia" aria-label={data(dia)}>
            <h3>{data(dia)}</h3>
            {itens.map(linha)}
          </section>
        ))
      )}

      {aberta?.tipo === "categoria" && movAberto && partesDe(movAberto).length <= 1 && (
        <JanelaCategoria key={movAberto.id} mov={movAberto} grupos={grupos} migrado={brutos.categoriasMigradas} aoSalvo={salvo} aoFechar={fechar} />
      )}
      {movAberto && (aberta?.tipo === "detalhes" || partesDe(movAberto).length > 1) && <DetalhesLancamento key={movAberto.id} mov={movAberto} brutos={brutos} aoSalvo={salvo} aoFechar={fechar} />}
      {aberta?.tipo === "rapido" && <ModoRapido fila={aberta.fila} brutos={brutos} aoFim={() => salvo()} aoFechar={fechar} />}
    </div>
  );
}
