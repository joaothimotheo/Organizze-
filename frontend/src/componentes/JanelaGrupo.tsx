import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Grupo, NovoGrupo } from "../api";
import { CORES_GRUPO, lerDetalhes, type TipoGrupo } from "../grupos";

const MAX_LETRAS = 40;
const MAX_DETALHES = 20;

/**
 * Janela para criar ou editar um grupo de gasto ou uma origem de entrada: nome, cor, detalhes
 * separados por vírgula e, só para gasto, "Pedir para quem". Num grupo padrão, só a cor e os
 * detalhes mudam. `aoSalvar` grava; se der erro, a mensagem aparece aqui dentro.
 */
export default function JanelaGrupo({
  tipo,
  inicial,
  corSugerida = "g1",
  aoSalvar,
  aoFechar,
}: {
  tipo: TipoGrupo;
  inicial?: Grupo;
  corSugerida?: string;
  aoSalvar: (g: NovoGrupo) => Promise<void>;
  aoFechar: () => void;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [cor, setCor] = useState(inicial?.cor ?? corSugerida);
  const [detalhes, setDetalhes] = useState((inicial?.detalhes ?? []).join(", "));
  const [pedePessoa, setPedePessoa] = useState(inicial?.pede_pessoa ?? false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const janela = useRef<HTMLDivElement>(null);
  const entrada = tipo === "entrada";
  const padrao = inicial?.padrao === true;

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !salvando) aoFechar();
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [aoFechar, salvando]);

  useEffect(() => {
    janela.current?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")?.focus();
  }, []);

  const nomeLimpo = nome.split(/\s+/).filter(Boolean).join(" ");
  const lista = lerDetalhes(detalhes);
  const detalheLongo = lista.find((d) => d.length > MAX_LETRAS);
  const problema = !nomeLimpo
    ? "Dê um nome."
    : nomeLimpo.length > MAX_LETRAS
      ? `O nome pode ter até ${MAX_LETRAS} letras.`
      : detalheLongo
        ? `Cada detalhe pode ter até ${MAX_LETRAS} letras ("${detalheLongo.slice(0, 20)}…").`
        : lista.length > MAX_DETALHES
          ? `No máximo ${MAX_DETALHES} detalhes.`
          : null;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (problema) return;
    setSalvando(true);
    setErro(null);
    try {
      await aoSalvar({ nome: nomeLimpo, tipo, cor, detalhes: lista, pede_pessoa: !entrada && pedePessoa });
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
      setSalvando(false);
    }
  }

  const titulo = inicial ? (entrada ? "Editar origem" : "Editar grupo") : entrada ? "Nova origem de entrada" : "Novo grupo de gasto";

  return (
    <div
      className="janela-fundo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !salvando) aoFechar();
      }}
    >
      <div className="janela" role="dialog" aria-modal="true" aria-labelledby="grupo-titulo" ref={janela}>
        <div className="janela-alca" aria-hidden="true" />
        <h3 id="grupo-titulo">{titulo}</h3>
        <form className="janela-form" onSubmit={salvar} noValidate>
          <label className="field">
            <span className="rotulo-campo">Nome</span>
            <input
              type="text"
              maxLength={MAX_LETRAS}
              disabled={padrao}
              placeholder={entrada ? "Ex.: Aluguel que recebo" : "Ex.: Carro, Pets, Presentes"}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
            {padrao && <span className="note">Este grupo vem no app: o nome não muda.</span>}
          </label>
          <div className="field">
            <span className="rotulo-campo" id="grupo-cor">
              Cor
            </span>
            <div className="grupo-cores" role="group" aria-labelledby="grupo-cor">
              {CORES_GRUPO.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  className="grupo-cor"
                  style={{ background: `var(--${c})` }}
                  aria-pressed={cor === c}
                  aria-label={`Cor ${i + 1}`}
                  onClick={() => setCor(c)}
                />
              ))}
            </div>
          </div>
          <label className="field">
            <span className="rotulo-campo">Detalhes (opcional, separe por vírgula)</span>
            <input
              type="text"
              placeholder={entrada ? "Ex.: Inquilino A, Inquilino B" : "Ex.: Combustível, Manutenção, IPVA e seguro"}
              value={detalhes}
              onChange={(e) => setDetalhes(e.target.value)}
            />
            <span className="note">Ao escolher o grupo num lançamento, o detalhe é opcional.</span>
          </label>
          {!entrada && !padrao && (
            <label className="check grupo-pessoa">
              <input type="checkbox" checked={pedePessoa} onChange={(e) => setPedePessoa(e.target.checked)} />
              <span>
                Pedir para quem
                <small className="note"> Ao lançar neste grupo, pergunta a pessoa (por exemplo, Pix para alguém).</small>
              </span>
            </label>
          )}
          {nome !== "" && problema && <span className="campo-erro">{problema}</span>}
          {erro && <div className="erro">{erro}</div>}
          <div className="janela-acoes">
            <button type="button" onClick={aoFechar} disabled={salvando}>
              Cancelar
            </button>
            <button type="submit" className="primary" disabled={!!problema || salvando}>
              {salvando ? "Salvando…" : inicial ? "Salvar" : "Criar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
