import type { ReactNode } from "react";
import { reais } from "../formato";

interface Props {
  rotulo: string;
  valor: number | null;
  detalhe: ReactNode;
  vazio?: string;
  comSinal?: boolean;
  estimado?: boolean;
}

/** Cartão de indicador. Sem dados, mostra o que falta em vez de zero. */
export function Indicador({ rotulo, valor, detalhe, vazio = "Sem dados", comSinal, estimado }: Props) {
  const semDados = valor === null;
  const classe = semDados ? "val nodata" : "val" + (comSinal && valor < 0 ? " neg" : "");
  return (
    <div className="kpi">
      <div className="lbl">{rotulo}</div>
      <div className={classe}>{semDados ? vazio : reais(valor)}</div>
      <div className="sub">{detalhe}</div>
      {estimado && <span className="tag est">contém estimativas</span>}
    </div>
  );
}

export function Vazio({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="empty">
      <b>{titulo}</b>
      <span>{children}</span>
    </div>
  );
}

export function Painel({ titulo, descricao, largo, children }: { titulo: string; descricao: string; largo?: boolean; children: ReactNode }) {
  return (
    <div className={"panel" + (largo ? " wide" : "")}>
      <h2>{titulo}</h2>
      <p className="desc">{descricao}</p>
      {children}
    </div>
  );
}
