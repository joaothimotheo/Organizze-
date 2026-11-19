import type { Movimentacao } from "../api";
import { nomeCategoria, reais } from "../formato";
import { linkDetalhes } from "../movimentos";

/**
 * No lugar do seletor de categoria, para um lançamento dividido em partes (um toque no seletor
 * desfaria a divisão): as partes e um link que abre os detalhes em Movimentos.
 */
export default function PartesDivididas({ m }: { m: Movimentacao }) {
  const partes = m.partes ?? [];
  const texto = partes.map((p) => `${p.categoria === "a_classificar" ? "Sem categoria" : nomeCategoria(p.categoria)} ${reais(Math.abs(p.valor))}`).join(" + ");
  return (
    <a className={"lanc-dividido" + (partes.some((p) => p.categoria === "a_classificar") ? " falta" : "")} href={linkDetalhes(m.id)} title="Abrir os detalhes em Movimentos">
      Dividido: {texto} · ver em Movimentos
    </a>
  );
}
