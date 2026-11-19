import { useState } from "react";
import { api, type Brutos, type Grupo, type Movimentacao } from "../api";
import { data, nomeCategoria, reais } from "../formato";
import { naoConta, nomeNatureza } from "../grupos";
import {
  aplicarEscolha,
  corpoEdicao,
  efeitoVinculo,
  lerLigacao,
  lerPartes,
  linhasAoDividir,
  MAX_PARTES,
  MIN_PARTES,
  opcaoDaEscolha,
  opcoesDetalhe,
  opcoesVinculo,
  sobraParte,
  textoLigacao,
  type Escolha,
  type LinhaParte,
} from "../movimentos";
import { nomeConta } from "../paginas/Enviar";
import Janela, { ResumoLancamento } from "./Janela";
import { EscolhaDetalhe, opcoesDeGrupo, opcoesNaoConta } from "./JanelaCategoria";

const msgDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const TAMANHO_NOME = 120;
/** 312.45 → "312,45" para o campo. */
const paraCampo = (v: number) => Math.abs(v).toFixed(2).replace(".", ",");

/**
 * Detalhes do lançamento: nome (vazio volta ao do banco), categoria, "Dividir em partes" (depois de
 * migrar, só para gasto ou entrada) e "Ligar a" dívida, pessoa ou conta fixa. Salva só o que
 * mudou, num PATCH só; erros do servidor aparecem aqui dentro.
 */
export default function DetalhesLancamento({
  mov,
  brutos,
  aoSalvo,
  aoFechar,
}: {
  mov: Movimentacao;
  brutos: Brutos;
  /** Depois de salvar: recarrega, fecha e mostra o aviso. */
  aoSalvo: (aviso: string) => Promise<void> | void;
  aoFechar: () => void;
}) {
  const migrado = brutos.categoriasMigradas;
  const grupos = brutos.categorias as unknown as Grupo[];
  const [nome, setNome] = useState(mov.nome ?? "");
  const [escolha, setEscolha] = useState<Escolha>({ categoria: mov.categoria || "a_classificar", natureza: mov.natureza });
  const [detalhe, setDetalhe] = useState<string | null>(mov.subcategoria ?? null);
  const [linhas, setLinhas] = useState<LinhaParte[] | null>(() =>
    mov.partes?.length ? mov.partes.map((p) => ({ valor: paraCampo(p.valor), categoria: p.categoria, subcategoria: p.subcategoria })) : null,
  );
  // A 2ª parte acompanha a 1ª (o que falta) até você mexer nela.
  const [segundaAuto, setSegundaAuto] = useState(false);
  const [ligacao, setLigacao] = useState(textoLigacao(mov.vinculo));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const saida = mov.valor < 0;
  const conta = !naoConta({ natureza: escolha.natureza });
  const podeDividir = migrado && conta;
  const grupoOpcoes = opcoesDeGrupo(mov, grupos, migrado);
  const naoContam = opcoesNaoConta(mov);
  const marcada = opcaoDaEscolha(escolha, migrado);
  const fora = [...grupoOpcoes, ...naoContam].some((o) => o.valor === marcada)
    ? null
    : escolha.categoria === "a_classificar"
      ? "Sem categoria"
      : nomeCategoria(escolha.categoria);

  const conf = linhas ? lerPartes(mov.valor, linhas) : null;
  const vinculo = lerLigacao(ligacao);
  // Depois de migrar, gasto ou entrada com grupo: o detalhe dele (opcional) vai junto.
  const comDetalhe = migrado && conta && escolha.categoria !== "a_classificar";
  const detalhes = comDetalhe ? opcoesDetalhe(grupos.find((g) => g.id === escolha.categoria)?.detalhes, detalhe) : [];
  const corpo = corpoEdicao(mov, { nome, ...escolha, ...(comDetalhe ? { subcategoria: detalhe } : {}), partes: conf ? conf.partes : null, vinculo }, migrado);
  const nomeLongo = nome.trim().length > TAMANHO_NOME;
  const bloqueado = !corpo || nomeLongo || (conf !== null && !conf.ok) || salvando;
  const cadastrada = brutos.contas.find((c) => c.id === mov.conta_id);
  const nomeDaConta = !mov.conta_id || mov.conta_id === "dinheiro" ? "Dinheiro" : cadastrada ? nomeConta(cadastrada) : null;
  const ligaveis = opcoesVinculo(mov, brutos);

  function mudarLinha(i: number, l: Partial<LinhaParte>) {
    const auto = segundaAuto && !(i === 1 && l.valor !== undefined);
    if (!auto) setSegundaAuto(false);
    setLinhas(
      (ls) =>
        ls &&
        ls.map((x, j) => {
          if (j === i) return { ...x, ...l, ...(l.categoria !== undefined ? { subcategoria: null } : {}) };
          if (j === 1 && i === 0 && auto && l.valor !== undefined) return { ...x, valor: sobraParte(mov.valor, l.valor) };
          return x;
        }),
    );
  }

  function dividir() {
    setErro(null);
    setSegundaAuto(true);
    setLinhas(linhasAoDividir(escolha.categoria, detalhe));
  }

  async function salvar() {
    if (bloqueado || !corpo) return;
    setSalvando(true);
    setErro(null);
    try {
      await api.editarLancamento(mov.id, corpo);
    } catch (e) {
      setErro(msgDe(e));
      setSalvando(false);
      return;
    }
    // Já salvou: a recarga e o aviso ficam com quem abriu a janela.
    await aoSalvo("Lançamento salvo.");
  }

  const opcoesParte = (
    <>
      <option value="a_classificar">A classificar</option>
      {grupoOpcoes.map((o) => (
        <option key={o.valor} value={o.valor.slice(4)}>
          {o.nome}
        </option>
      ))}
    </>
  );

  return (
    <Janela idTitulo="dt-titulo" ocupada={salvando} semFecharPorFora alterada={!!corpo} aoFechar={aoFechar}>
      <h3 id="dt-titulo">Detalhes do lançamento</h3>
      <ResumoLancamento
        titulo={mov.descricao}
        sub={[data(mov.data), nomeDaConta].filter(Boolean).join(" · ")}
        valor={reais(mov.valor)}
        positivo={!saida}
      />

      <label className="field">
        <span className="rotulo-campo">Nome que aparece no app</span>
        <input type="text" maxLength={TAMANHO_NOME} placeholder={mov.descricao} value={nome} disabled={salvando} onChange={(e) => setNome(e.target.value)} />
        <span className="note">Vazio volta a mostrar o nome do banco.</span>
      </label>

      {linhas ? (
        <div className="field">
          <span className="rotulo-campo">Partes</span>
          {linhas.map((l, i) => (
            <div key={i} className="jn-parte">
              <input
                type="text"
                inputMode="decimal"
                aria-label={`Valor da parte ${i + 1}`}
                placeholder="0,00"
                value={l.valor}
                disabled={salvando}
                onChange={(e) => mudarLinha(i, { valor: e.target.value })}
              />
              <select aria-label={`Categoria da parte ${i + 1}`} value={l.categoria} disabled={salvando} onChange={(e) => mudarLinha(i, { categoria: e.target.value })}>
                {!grupoOpcoes.some((o) => o.valor === `cat:${l.categoria}`) && l.categoria !== "a_classificar" && (
                  <option value={l.categoria} disabled>
                    {nomeCategoria(l.categoria)}
                  </option>
                )}
                {opcoesParte}
              </select>
              {linhas.length > MIN_PARTES && (
                <button type="button" className="jn-tirar" aria-label={`Tirar a parte ${i + 1}`} disabled={salvando} onClick={() => (setSegundaAuto(false), setLinhas(linhas.filter((_, j) => j !== i)))}>
                  ×
                </button>
              )}
            </div>
          ))}
          <div className="jn-partes-pe">
            {linhas.length < MAX_PARTES && (
              <button type="button" className="btn-link" disabled={salvando} onClick={() => (setSegundaAuto(false), setLinhas([...linhas, { valor: "", categoria: "a_classificar" }]))}>
                + Outra parte
              </button>
            )}
            <span className={"jn-conf" + (conf?.ok ? " ok" : "")} role="status">
              {conf?.aviso}
            </span>
          </div>
          <button type="button" className="btn-link jn-desfazer" disabled={salvando} onClick={() => setLinhas(null)}>
            Desfazer divisão
          </button>
        </div>
      ) : (
        <>
          <label className="field">
            <span className="rotulo-campo">{saida ? "Categoria" : "De onde veio"}</span>
            <select
              value={marcada}
              disabled={salvando}
              onChange={(e) => {
                const nova = aplicarEscolha(mov, escolha, e.target.value, migrado);
                if (nova.categoria !== escolha.categoria) setDetalhe(null);
                setEscolha(nova);
              }}
            >
              {fora !== null && (
                <option value={marcada} disabled>
                  {fora}
                </option>
              )}
              <optgroup label={saida ? "Grupo" : "Origem"}>
                {grupoOpcoes.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.nome}
                  </option>
                ))}
              </optgroup>
              <optgroup label={saida ? "Não é gasto" : "Não é ganho"}>
                {naoContam.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.nome}
                  </option>
                ))}
              </optgroup>
            </select>
            {!migrado && !conta && <span className="note">Não conta no mês: {nomeNatureza(escolha.natureza)}.</span>}
          </label>
          {detalhes.length > 0 && <EscolhaDetalhe detalhes={detalhes} valor={detalhe} desativada={salvando} aoMudar={setDetalhe} />}
          {podeDividir && (
            <div className="jn-dividir">
              <button type="button" disabled={salvando} onClick={dividir}>
                Dividir em partes
              </button>
              <span className="note">Ex.: no mercado, uma parte Comida e outra Casa.</span>
            </div>
          )}
        </>
      )}

      <label className="field">
        <span className="rotulo-campo">Ligar a</span>
        <select value={ligacao} disabled={salvando} onChange={(e) => setLigacao(e.target.value)}>
          <option value="">Nada</option>
          {ligaveis.map((g) => (
            <optgroup key={g.grupo} label={g.grupo}>
              {g.itens.map((i) => (
                <option key={i.valor} value={i.valor}>
                  {i.nome}
                </option>
              ))}
            </optgroup>
          ))}
          {ligacao && !ligaveis.some((g) => g.itens.some((i) => i.valor === ligacao)) && (
            <option value={ligacao} disabled>
              Registro que não existe mais
            </option>
          )}
        </select>
        <span className="note">{efeitoVinculo(vinculo?.tipo, !saida, !!mov.vinculo)}</span>
      </label>

      {nomeLongo && <span className="campo-erro">O nome pode ter até {TAMANHO_NOME} letras.</span>}
      {erro && <div className="erro">{erro}</div>}
      <div className="janela-acoes">
        <button type="button" onClick={aoFechar} disabled={salvando}>
          Cancelar
        </button>
        <button type="button" className="primary" onClick={salvar} disabled={bloqueado}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </Janela>
  );
}
