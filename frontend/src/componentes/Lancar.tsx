import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Movimentacao } from "../api";
import { lerValor, VALOR_MAXIMO } from "../navegacao";

type Tipo = "gasto" | "entrada";

function hojeIso(): string {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
}

/** Janela do +: primeiro escolhe o que fazer (gasto, entrada ou organizar), depois preenche. */
export default function Lancar({
  pendentes,
  contas,
  aoFechar,
  aoSalvo,
  aoOrganizar,
}: {
  pendentes: number;
  contas: { id: string; nome: string }[];
  aoFechar: () => void;
  aoSalvo: (mov: Movimentacao) => void;
  aoOrganizar: () => void;
}) {
  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [conta, setConta] = useState<string | null>(null);
  const [dia, setDia] = useState(hojeIso);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const janela = useRef<HTMLDivElement>(null);

  // Enquanto salva, Esc e clique fora não fecham: o lançamento pode ser gravado sem você ver o aviso.
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !salvando) aoFechar();
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [aoFechar, salvando]);

  // Leva o foco para dentro da janela a cada passo.
  useEffect(() => {
    janela.current?.querySelector<HTMLElement>("input, button:not(:disabled)")?.focus();
  }, [tipo]);

  const numero = lerValor(valor);
  const texto = descricao.trim();
  const acimaDoTeto = numero !== null && numero > VALOR_MAXIMO;
  const pronto = numero !== null && !acimaDoTeto && texto.length > 0 && dia !== "";

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!tipo || numero === null || !pronto) return;
    setSalvando(true);
    setErro(null);
    try {
      const mov = await api.criarLancamento({ tipo, valor: numero, descricao: texto, data: dia, conta_id: conta });
      aoSalvo(mov);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setSalvando(false);
    }
  }

  const entrada = tipo === "entrada";
  const titulo = tipo === null ? "O que você quer fazer?" : entrada ? "Nova entrada" : "Novo gasto";

  return (
    <div
      className="janela-fundo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !salvando) aoFechar();
      }}
    >
      <div className="janela" role="dialog" aria-modal="true" aria-labelledby="lancar-titulo" ref={janela}>
        <div className="janela-alca" aria-hidden="true" />
        <h3 id="lancar-titulo">{titulo}</h3>

        {tipo === null ? (
          <>
            <div className="acoes-lancar">
              <button type="button" className="opcao" onClick={() => setTipo("gasto")}>
                <i className="opcao-cor gasto" aria-hidden="true" />
                <span>
                  <b>Lançar um gasto</b>
                  <small>Dinheiro vivo ou algo que o banco não pegou</small>
                </span>
              </button>
              <button type="button" className="opcao" onClick={() => setTipo("entrada")}>
                <i className="opcao-cor entrada" aria-hidden="true" />
                <span>
                  <b>Lançar uma entrada</b>
                  <small>Dinheiro que entrou fora do banco</small>
                </span>
              </button>
              <button type="button" className="opcao" onClick={aoOrganizar} disabled={pendentes === 0}>
                <i className="opcao-cor pendente" aria-hidden="true" />
                <span>
                  <b>Organizar pendentes{pendentes ? ` (${pendentes})` : ""}</b>
                  <small>{pendentes ? "Lançamentos sem categoria" : "Nada pendente agora"}</small>
                </span>
              </button>
            </div>
            <div className="janela-acoes">
              <button type="button" onClick={aoFechar}>
                Fechar
              </button>
            </div>
          </>
        ) : (
          <form className="janela-form" onSubmit={salvar}>
            <label className="field">
              <span className="rotulo-campo">Valor (R$)</span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                aria-invalid={acimaDoTeto}
                aria-describedby={acimaDoTeto ? "lancar-teto" : undefined}
              />
              {acimaDoTeto && (
                <span className="campo-erro" id="lancar-teto">
                  O valor pode ser até R$ 1.000.000,00.
                </span>
              )}
            </label>
            <label className="field">
              <span className="rotulo-campo">Descrição</span>
              <input
                type="text"
                maxLength={120}
                placeholder={entrada ? "Ex.: venda da bicicleta" : "Ex.: feira, lanche, estacionamento"}
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
              />
            </label>
            <div className="field">
              <span className="rotulo-campo" id="lancar-conta">
                {entrada ? "Recebido em" : "Pago com"}
              </span>
              <div className="contas-lancar" role="group" aria-labelledby="lancar-conta">
                <button type="button" aria-pressed={conta === null} onClick={() => setConta(null)}>
                  Dinheiro
                </button>
                {contas.map((c) => (
                  <button key={c.id} type="button" aria-pressed={conta === c.id} onClick={() => setConta(c.id)}>
                    {c.nome}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span className="rotulo-campo">Data</span>
              <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
            </label>
            {erro && <div className="erro">{erro}</div>}
            <div className="janela-acoes">
              <button type="button" onClick={() => setTipo(null)} disabled={salvando}>
                Voltar
              </button>
              <button type="submit" className="primary" disabled={!pronto || salvando}>
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
