import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Moldura das janelas (folha que sobe no celular, caixa no centro no computador): Esc e clique
 * fora fecham, menos enquanto `ocupada` (salvando) ou `inativa` (outra janela aberta por cima).
 * Com `semFecharPorFora`, o clique fora não fecha; com `alterada` (há o que salvar), o Esc
 * pergunta aqui dentro se descarta as alterações.
 * O foco entra na janela ao abrir e a cada `passo` novo: no primeiro campo ou botão, ou na
 * própria janela com `focarJanela` (para um Enter não escolher nada sem querer).
 */
export default function Janela({
  idTitulo,
  ocupada,
  inativa,
  passo,
  focarJanela,
  semFecharPorFora,
  alterada,
  aoFechar,
  children,
}: {
  idTitulo: string;
  ocupada?: boolean;
  inativa?: boolean;
  passo?: unknown;
  focarJanela?: boolean;
  semFecharPorFora?: boolean;
  alterada?: boolean;
  aoFechar: () => void;
  children: ReactNode;
}) {
  const janela = useRef<HTMLDivElement>(null);
  const voltar = useRef<HTMLButtonElement>(null);
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    if (inativa) return;
    const f = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || ocupada) return;
      if (confirmando) setConfirmando(false);
      else if (alterada) setConfirmando(true);
      else aoFechar();
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [aoFechar, ocupada, inativa, alterada, confirmando]);

  useEffect(() => {
    if (confirmando) voltar.current?.focus();
  }, [confirmando]);

  useEffect(() => {
    const j = janela.current;
    if (!j) return;
    if (focarJanela) j.focus();
    else j.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), button:not(:disabled)")?.focus();
  }, [passo, focarJanela]);

  return (
    <div
      className="janela-fundo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !ocupada && !inativa && !semFecharPorFora) aoFechar();
      }}
    >
      <div className="janela jn" role="dialog" aria-modal="true" aria-labelledby={idTitulo} ref={janela} tabIndex={-1}>
        <div className="janela-alca" aria-hidden="true" />
        {children}
        {confirmando && (
          <div className="jn-confirmar" role="alertdialog" aria-label="Descartar as alterações?">
            <b>Descartar as alterações?</b>
            <span>
              <button type="button" onClick={aoFechar}>
                Descartar
              </button>
              <button type="button" className="primary" ref={voltar} onClick={() => setConfirmando(false)}>
                Voltar
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Caixa com o lançamento: nome, data e descrição do banco à esquerda; valor à direita. */
export function ResumoLancamento({ titulo, sub, valor, positivo, grande }: { titulo: string; sub: string; valor: string; positivo: boolean; grande?: boolean }) {
  return (
    <div className={"jn-resumo" + (grande ? " grande" : "")}>
      <span>
        <b>{titulo}</b>
        <small>{sub}</small>
      </span>
      <b className={"num" + (positivo ? " pos" : "")}>{valor}</b>
    </div>
  );
}

/** Uma opção da grade (grupo ou natureza): amostra de cor, nome e texto curto. */
export interface OpcaoGrade {
  valor: string;
  nome: string;
  texto?: string;
  /** Token de cor do grupo ("g3"); sem cor, contorno tracejado. */
  cor?: string;
  marcada?: boolean;
}

export function Grade({ opcoes, rotulo, desativada, aoEscolher, extra }: { opcoes: OpcaoGrade[]; rotulo: string; desativada?: boolean; aoEscolher: (valor: string) => void; extra?: ReactNode }) {
  return (
    <div className="jn-opts" role="group" aria-label={rotulo}>
      {opcoes.map((o) => (
        <button key={o.valor} type="button" className="jn-opt" aria-pressed={o.marcada} disabled={desativada} onClick={() => aoEscolher(o.valor)}>
          <i className={"jn-sw" + (o.cor ? "" : " vazia")} style={o.cor ? { background: `var(--${o.cor})` } : undefined} aria-hidden="true" />
          <span>
            <b>{o.nome}</b>
            {o.texto && <small>{o.texto}</small>}
          </span>
        </button>
      ))}
      {extra}
    </div>
  );
}
