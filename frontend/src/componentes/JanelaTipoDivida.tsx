import { useState, type FormEvent } from "react";
import Janela from "./Janela";

const MAX_LETRAS = 40;

/** Nome comparável: sem acento, sem diferença de maiúscula e com espaços simples. */
const chave = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");

/**
 * Janela "Novo tipo de dívida": só o nome. `existentes` são os nomes que já existem (padrões e
 * criados), para avisar antes de gravar. `aoSalvar` grava; se der erro, a mensagem aparece aqui.
 */
export default function JanelaTipoDivida({ existentes, aoSalvar, aoFechar }: { existentes: string[]; aoSalvar: (nome: string) => Promise<void>; aoFechar: () => void }) {
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const limpo = nome.split(/\s+/).filter(Boolean).join(" ");
  const problema = !limpo
    ? "Dê um nome."
    : limpo.length > MAX_LETRAS
      ? `O nome pode ter até ${MAX_LETRAS} letras.`
      : existentes.some((e) => chave(e) === chave(limpo))
        ? "Já existe um tipo com esse nome."
        : null;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (problema) return;
    setSalvando(true);
    setErro(null);
    try {
      await aoSalvar(limpo);
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
      setSalvando(false);
    }
  }

  return (
    <Janela idTitulo="tipo-divida-titulo" ocupada={salvando} alterada={limpo !== ""} aoFechar={aoFechar}>
      <h3 id="tipo-divida-titulo">Novo tipo de dívida</h3>
      <p className="note">Ex.: Acordos, Financiamento do carro, Cheque especial.</p>
      <form className="janela-form" onSubmit={salvar} noValidate>
        <label className="field">
          <span className="rotulo-campo">Nome</span>
          <input type="text" maxLength={MAX_LETRAS} placeholder="Nome do tipo" value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        {nome !== "" && problema && <span className="campo-erro">{problema}</span>}
        {erro && <div className="erro">{erro}</div>}
        <div className="janela-acoes">
          <button type="button" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!!problema || salvando}>
            {salvando ? "Salvando…" : "Criar"}
          </button>
        </div>
      </form>
    </Janela>
  );
}
