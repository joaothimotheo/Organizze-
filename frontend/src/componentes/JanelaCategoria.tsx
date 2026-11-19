import { useState } from "react";
import { api, type Grupo, type Movimentacao, type NovoGrupo } from "../api";
import { data, opcoesCategoria, reais } from "../formato";
import { ehEntrada, NATUREZAS_NAO_CONTA, naoConta, proximaCor } from "../grupos";
import { aplicarEscolha, corpoEdicao, opcaoDaEscolha, opcoesDetalhe, type Escolha } from "../movimentos";
import Janela, { Grade, ResumoLancamento, type OpcaoGrade } from "./Janela";
import JanelaGrupo from "./JanelaGrupo";
import { tituloDe } from "./NomeLancamento";

const msgDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const TAMANHO_QUEM = 60;

/**
 * Grupos que servem para o lançamento: depois de migrar, só os do tipo do valor (saída → gasto,
 * entrada → entrada); antes, as categorias antigas todas (não têm tipo).
 */
export function opcoesDeGrupo(m: Movimentacao, grupos: Grupo[], migrado: boolean, escolha?: Escolha): OpcaoGrade[] {
  const marcada = escolha ? opcaoDaEscolha(escolha, migrado) : null;
  if (!migrado)
    return opcoesCategoria()
      .filter(([id]) => id !== "a_classificar")
      .map(([id, nome]) => ({ valor: `cat:${id}`, nome, marcada: marcada === null ? undefined : marcada === `cat:${id}` }));
  const tipo = m.valor < 0 ? "gasto" : "entrada";
  return grupos
    .filter((g) => g.tipo === tipo && g.id !== "a_classificar")
    .map((g) => ({
      valor: `cat:${g.id}`,
      nome: g.nome,
      texto: g.detalhes?.length ? g.detalhes.join(" · ") : undefined,
      cor: g.cor,
      marcada: marcada === null ? undefined : marcada === `cat:${g.id}`,
    }));
}

/** "Detalhe (opcional)": um dos detalhes do grupo escolhido, ou nenhum. */
export function EscolhaDetalhe({ detalhes, valor, desativada, aoMudar }: { detalhes: string[]; valor: string | null; desativada?: boolean; aoMudar: (d: string | null) => void }) {
  return (
    <label className="field">
      <span className="rotulo-campo">Detalhe (opcional)</span>
      <select value={valor ?? ""} disabled={desativada} onChange={(e) => aoMudar(e.target.value || null)}>
        <option value="">Nenhum</option>
        {detalhes.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </label>
  );
}

/** O que não conta no mês, do lado do valor (saída ou entrada). */
export function opcoesNaoConta(m: Movimentacao, escolha?: Escolha): OpcaoGrade[] {
  return NATUREZAS_NAO_CONTA[m.valor < 0 ? "saida" : "entrada"].map(([n, nome, texto]) => ({
    valor: `nat:${n}`,
    nome,
    texto,
    marcada: escolha ? escolha.natureza === n : undefined,
  }));
}

/**
 * Janela "Que gasto foi esse?" / "De onde veio esse dinheiro?": grade de grupos (e "+ Novo
 * grupo" depois de migrar), o que não conta no mês, "Quem mandou"/"Para quem" e a caixa para
 * usar a mesma escolha nos próximos de mesma descrição. Salva num PATCH só o que mudou.
 */
export default function JanelaCategoria({
  mov,
  grupos,
  migrado,
  aoSalvo,
  aoFechar,
}: {
  mov: Movimentacao;
  grupos: Grupo[];
  migrado: boolean;
  /** Depois de salvar: recarrega, fecha e mostra o aviso. */
  aoSalvo: (aviso: string) => Promise<void> | void;
  aoFechar: () => void;
}) {
  const [escolha, setEscolha] = useState<Escolha>({ categoria: mov.categoria || "a_classificar", natureza: mov.natureza });
  const [detalhe, setDetalhe] = useState<string | null>(mov.subcategoria ?? null);
  const [quem, setQuem] = useState(mov.quem ?? "");
  const [mesma, setMesma] = useState(true);
  const [criando, setCriando] = useState(false);
  const [novos, setNovos] = useState<Grupo[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const saida = mov.valor < 0;
  const todos = [...grupos, ...novos];
  const opcoes = opcoesDeGrupo(mov, todos, migrado, escolha);
  // Antes de migrar, a categoria e a natureza são escolhas separadas: as duas podem aparecer marcadas.
  const naoContam = opcoesNaoConta(mov, escolha);
  const grupoEscolhido = todos.find((g) => g.id === escolha.categoria);
  const conta = !naoConta({ natureza: escolha.natureza });
  const entrada = ehEntrada({ natureza: escolha.natureza }) || (!conta && !saida);
  const pedeQuem = entrada || (conta && !!grupoEscolhido?.pede_pessoa) || !!mov.quem;
  const nomeCurto = tituloDe(mov);

  // Mudar a categoria desfaz a divisão; sem mudança, as partes ficam como estão.
  const mudou = escolha.categoria !== (mov.categoria || "a_classificar") || escolha.natureza !== mov.natureza;
  // Depois de migrar, gasto ou entrada com grupo: o detalhe dele (opcional) vai junto.
  const comDetalhe = migrado && conta && escolha.categoria !== "a_classificar";
  const detalhes = comDetalhe ? opcoesDetalhe(grupoEscolhido?.detalhes, detalhe) : [];
  const corpo = corpoEdicao(
    mov,
    { ...escolha, ...(comDetalhe ? { subcategoria: detalhe } : {}), quem: pedeQuem ? quem : undefined, partes: !mudou && mov.partes?.length ? mov.partes : null },
    migrado,
  );
  if (corpo?.categoria) corpo.mesma_descricao = mesma;
  const quemLongo = quem.trim().length > TAMANHO_QUEM;

  function escolher(opcao: string) {
    setErro(null);
    const nova = aplicarEscolha(mov, escolha, opcao, migrado);
    // Outro grupo: o detalhe do anterior não vale.
    if (nova.categoria !== escolha.categoria) setDetalhe(null);
    setEscolha(nova);
  }

  async function criarGrupo(n: NovoGrupo) {
    const r = await api.criarGrupo(n);
    setNovos((l) => [...l, r.grupo]);
    setCriando(false);
    escolher(`cat:${r.grupo.id}`);
  }

  async function salvar() {
    if (!corpo || quemLongo) return;
    setSalvando(true);
    setErro(null);
    let n: number;
    try {
      n = (await api.editarLancamento(mov.id, corpo)).alterados?.length ?? 1;
    } catch (e) {
      setErro(msgDe(e));
      setSalvando(false);
      return;
    }
    // Já salvou: a recarga e o aviso ficam com quem abriu a janela.
    await aoSalvo(n > 1 ? `Salvo. Mais ${n - 1} lançamento${n - 1 === 1 ? "" : "s"} de "${mov.descricao}" seguiu a mesma escolha.` : "Salvo.");
  }

  return (
    <>
      <Janela idTitulo="jc-titulo" ocupada={salvando} inativa={criando} aoFechar={aoFechar}>
        <h3 id="jc-titulo">{saida ? "Que gasto foi esse?" : "De onde veio esse dinheiro?"}</h3>
        <ResumoLancamento titulo={nomeCurto} sub={[data(mov.data), mov.nome ? mov.descricao : null].filter(Boolean).join(" · ")} valor={reais(mov.valor)} positivo={!saida} />
        <Grade
          opcoes={opcoes}
          rotulo={saida ? "Grupos de gasto" : "Origens de entrada"}
          desativada={salvando}
          aoEscolher={escolher}
          extra={
            migrado && (
              <button type="button" className="jn-opt jn-novo" disabled={salvando} onClick={() => setCriando(true)}>
                <b>+ {saida ? "Novo grupo" : "Nova origem"}</b>
              </button>
            )
          }
        />
        {detalhes.length > 0 && <EscolhaDetalhe detalhes={detalhes} valor={detalhe} desativada={salvando} aoMudar={setDetalhe} />}
        <div className="jn-sec">{saida ? "Não é gasto" : "Não é ganho"}</div>
        <Grade opcoes={naoContam} rotulo={saida ? "Não é gasto" : "Não é ganho"} desativada={salvando} aoEscolher={escolher} />
        {pedeQuem && (
          <label className="field">
            <span className="rotulo-campo">{entrada ? "Quem mandou" : "Para quem"} (opcional)</span>
            <input type="text" maxLength={TAMANHO_QUEM} placeholder="Ex.: nome da pessoa ou empresa" value={quem} disabled={salvando} onChange={(e) => setQuem(e.target.value)} />
            {quemLongo && <span className="campo-erro">Até {TAMANHO_QUEM} letras.</span>}
          </label>
        )}
        <label className="check jn-lembrar">
          <input type="checkbox" checked={mesma} disabled={salvando} onChange={(e) => setMesma(e.target.checked)} />
          <span>Usar a mesma escolha nos próximos de "{mov.descricao}"</span>
        </label>
        {erro && <div className="erro">{erro}</div>}
        <div className="janela-acoes">
          <button type="button" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </button>
          <button type="button" className="primary" onClick={salvar} disabled={!corpo || quemLongo || salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </Janela>
      {criando && <JanelaGrupo tipo={saida ? "gasto" : "entrada"} corSugerida={proximaCor(todos.map((g) => g.cor).filter(Boolean))} aoSalvar={criarGrupo} aoFechar={() => setCriando(false)} />}
    </>
  );
}
