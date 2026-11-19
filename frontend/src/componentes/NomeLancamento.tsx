import { useState, type FormEvent } from "react";
import { api, type Movimentacao } from "../api";

/** Como o lançamento aparece nas listas: o nome que você deu, se houver; senão, a descrição do banco. */
export const tituloDe = (m: Pick<Movimentacao, "nome" | "descricao">) => (m.nome && m.nome.trim()) || m.descricao;

/**
 * Título do lançamento com o lápis para dar nome a ele ("Pix do Thiago: metade do aluguel").
 * Com nome, a descrição do banco aparece embaixo, menor, para não perder a referência.
 */
export function NomeLancamento({ m, aoMudar }: { m: Movimentacao; aoMudar: () => Promise<void> | void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(m.nome ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent, valor = texto) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      await api.nomear(m.id, valor.trim());
      setEditando(false);
      await aoMudar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
    } finally {
      setSalvando(false);
    }
  }

  function abrir() {
    setTexto(m.nome ?? "");
    setErro(null);
    setEditando(true);
  }

  return (
    <span className="lanc-titulo">
      <span className="lanc-nome" title={m.nome ? `${m.nome} (no banco: ${m.descricao})` : m.descricao}>
        {tituloDe(m)}{" "}
        {!editando && (
          <button type="button" className="lanc-renomear" onClick={abrir} aria-label={m.nome ? `Mudar o nome de ${tituloDe(m)}` : `Dar nome a ${m.descricao}`}>
            <IconeLapis />
            {!m.nome && <span>dar nome</span>}
          </button>
        )}
      </span>
      {m.nome && <span className="lanc-banco">No banco: {m.descricao}</span>}
      {editando && (
        <form className="lanc-form-nome" onSubmit={salvar} noValidate>
          <input
            type="text"
            maxLength={120}
            autoFocus
            placeholder="O que é? Ex.: Pix do Thiago, metade do aluguel"
            aria-label={`Nome para ${m.descricao}`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setEditando(false)}
          />
          <button type="submit" className="primary" disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
          {m.nome && (
            <button type="button" disabled={salvando} onClick={(e) => salvar(e as unknown as FormEvent, "")}>
              Tirar nome
            </button>
          )}
          <button type="button" className="btn-link" onClick={() => setEditando(false)}>
            Cancelar
          </button>
          {erro && <span className="cat-erro">{erro}</span>}
        </form>
      )}
    </span>
  );
}

function IconeLapis() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
