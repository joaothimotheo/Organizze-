import { useState, type FormEvent } from "react";
import { api } from "../api";
import { categoriasSaoGrupos, opcoesCategoria, rotuloFora } from "../formato";
import { CORES_GRUPO, nomeNatureza, soNatureza, tipoDaNatureza } from "../grupos";

const NOVA = "__nova";
const msgDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Lista de categorias com a opção "Criar categoria…" no fim. Ao criar, a nova categoria já
 * fica escolhida para o lançamento. Depois de migrar, as opções são os grupos do tipo que
 * combina com a `natureza` (gasto para despesa; entrada para receita e estorno); o que não conta
 * no mês (aporte, dívida paga, empréstimo, transferência...) mostra só o nome da natureza.
 */
export function SeletorCategoria({
  rotulo,
  valor,
  natureza,
  className,
  desativado,
  aoEscolher,
}: {
  rotulo: string;
  valor: string;
  /** Natureza do lançamento; sem ela, a lista não é filtrada. */
  natureza?: string | null;
  className?: string;
  desativado?: boolean;
  aoEscolher: (categoria: string) => Promise<void> | void;
}) {
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const tipo = tipoDaNatureza(natureza);
  const grupos = categoriasSaoGrupos();
  const opcoes = opcoesCategoria(tipo);
  // O valor atual pode não estar na lista (sem categoria ainda, ou um grupo de outro tipo).
  const fora = rotuloFora(valor, opcoes);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    try {
      let id: string;
      if (grupos) {
        const r = await api.criarGrupo({ nome, tipo: tipo ?? "gasto", cor: corLivre(opcoes.length) });
        id = r.grupo.id;
      } else {
        id = (await api.criarCategoria(nome)).id;
      }
      setCriando(false);
      setNome("");
      await aoEscolher(id);
    } catch (x) {
      setErro(msgDe(x));
    } finally {
      setOcupado(false);
    }
  }

  if (soNatureza(grupos, natureza)) return <span className="lanc-natureza">{nomeNatureza(natureza ?? "")}</span>;

  if (criando)
    return (
      <form className="cat-nova" onSubmit={criar} noValidate>
        <input
          type="text"
          autoFocus
          maxLength={40}
          placeholder={grupos ? "Nome do grupo" : "Nome da categoria"}
          aria-label={grupos ? "Nome do novo grupo" : "Nome da nova categoria"}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        <button type="submit" className="primary" disabled={ocupado || !nome.trim()}>
          {ocupado ? "Criando…" : "Criar"}
        </button>
        <button type="button" className="btn-link" onClick={() => (setCriando(false), setErro(null))}>
          Cancelar
        </button>
        {erro && <span className="cat-erro">{erro}</span>}
      </form>
    );

  return (
    <select
      className={className}
      aria-label={rotulo}
      value={valor}
      disabled={desativado}
      onChange={(e) => (e.target.value === NOVA ? setCriando(true) : aoEscolher(e.target.value))}
    >
      {fora !== null && (
        <option value={valor} disabled>
          {fora}
        </option>
      )}
      {opcoes.map(([k, n]) => (
        <option key={k} value={k}>
          {n}
        </option>
      ))}
      <option value={NOVA}>{grupos ? (tipo === "entrada" ? "Criar origem…" : "Criar grupo…") : "Criar categoria…"}</option>
    </select>
  );
}

/** Cor do grupo criado pela lista: vai girando conforme a quantidade de grupos. */
function corLivre(n: number) {
  return CORES_GRUPO[n % CORES_GRUPO.length];
}
