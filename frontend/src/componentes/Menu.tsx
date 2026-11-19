import type { ReactNode } from "react";
import { abaDoCelular, MENU_FIM, MENU_ORGANIZAR, MENU_PRINCIPAL, type Tela } from "../navegacao";

/** Desenhos dos ícones (os mesmos do protótipo), em traço de 1,8 na cor do texto. */
const DESENHOS = {
  inicio: (
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  movimentos: (
    <>
      <path d="M7 7h13M17 4l3 3-3 3" />
      <path d="M17 17H4M7 14l-3 3 3 3" />
    </>
  ),
  dividas: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  objetivos: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  analises: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  fixas: (
    <>
      <rect x="4" y="4" width="16" height="17" rx="2" />
      <path d="M8 2v4M16 2v4M4 10h16" />
    </>
  ),
  pessoas: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <path d="M16 4.5a3.5 3.5 0 010 7M18 14.8c1.8.7 3 2.5 3.5 5.2" />
    </>
  ),
  salarios: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  categorias: (
    <>
      <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4z" />
      <circle cx="16.5" cy="16.5" r="3.5" />
    </>
  ),
  ajustes: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </>
  ),
  mais: (
    <>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  rec: <path d="M11 7l-5 5 5 5M18 7l-5 5 5 5" />,
  abrir: <path d="M6 7l5 5-5 5M13 7l5 5-5 5" />,
  esq: <path d="M15 6l-6 6 6 6" />,
  dir: <path d="M9 6l6 6-6 6" />,
  sync: <path d="M20 11a8 8 0 00-14.9-3M4 4v4h4M4 13a8 8 0 0014.9 3M20 20v-4h-4" />,
} satisfies Record<string, ReactNode>;

export type NomeIcone = keyof typeof DESENHOS;

export function Icone({ nome, tamanho = 18 }: { nome: NomeIcone; tamanho?: number }) {
  return (
    <svg className="icone" width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {DESENHOS[nome]}
    </svg>
  );
}

/** Marca do app: as quatro barras, a mesma da tela de espera. */
export function Marca({ tamanho = 18 }: { tamanho?: number }) {
  return (
    <span className="brand-marca" aria-hidden="true">
      <svg width={tamanho} height={tamanho} viewBox="0 0 64 64">
        <path d="M16 44V30M28 44V22M40 44V34M52 44V16" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function ItemMenu({ item: [id, nome], tela, pendentes }: { item: [Tela, string]; tela: Tela; pendentes: number }) {
  const contador = id === "movimentos" && pendentes > 0 ? pendentes : null;
  return (
    <a href={`#${id}`} title={nome} aria-current={tela === id ? "page" : undefined}>
      <Icone nome={id} />
      <span className="side-nome">{nome}</span>
      {contador !== null && (
        <span className="side-contador" aria-label={`${contador} para organizar`}>
          {contador}
        </span>
      )}
    </a>
  );
}

/** Menu do computador, na lateral. Recolhido, mostra só os ícones. */
export function MenuLateral({
  tela,
  recolhido,
  pendentes,
  aoRecolher,
  aoLancar,
}: {
  tela: Tela;
  recolhido: boolean;
  pendentes: number;
  aoRecolher: () => void;
  aoLancar: () => void;
}) {
  const rotuloRecolher = recolhido ? "Abrir menu" : "Recolher menu";
  return (
    <nav className="side" aria-label="Menu">
      <div className="side-marca">
        <Marca />
        <b>Financeiro</b>
        <button type="button" className="rec-btn" onClick={aoRecolher} aria-label={rotuloRecolher} title={rotuloRecolher} aria-expanded={!recolhido}>
          <Icone nome={recolhido ? "abrir" : "rec"} />
        </button>
      </div>
      <button type="button" className="lancar" onClick={aoLancar} title="Lançar">
        <Icone nome="plus" />
        <span className="side-nome">Lançar</span>
      </button>
      {MENU_PRINCIPAL.map((it) => (
        <ItemMenu key={it[0]} item={it} tela={tela} pendentes={pendentes} />
      ))}
      <div className="side-grupo">Organizar</div>
      {MENU_ORGANIZAR.map((it) => (
        <ItemMenu key={it[0]} item={it} tela={tela} pendentes={pendentes} />
      ))}
      <div className="side-espaco" />
      {MENU_FIM.map((it) => (
        <ItemMenu key={it[0]} item={it} tela={tela} pendentes={pendentes} />
      ))}
    </nav>
  );
}

const BARRA: [ReturnType<typeof abaDoCelular>, string][] = [
  ["inicio", "Início"],
  ["movimentos", "Movimentos"],
  ["objetivos", "Objetivos"],
  ["mais", "Mais"],
];

/** Barra de baixo do celular, com o + no meio. */
export function BarraDeBaixo({ tela, aoLancar }: { tela: Tela; aoLancar: () => void }) {
  const acesa = abaDoCelular(tela);
  const item = ([id, nome]: (typeof BARRA)[number]) => (
    <a key={id} href={`#${id}`} aria-current={acesa === id ? "page" : undefined}>
      <Icone nome={id} tamanho={22} />
      <span>{nome}</span>
    </a>
  );
  return (
    <nav className="bottom" aria-label="Menu">
      {BARRA.slice(0, 2).map(item)}
      <button type="button" className="plus" onClick={aoLancar} aria-label="Lançar">
        <Icone nome="plus" tamanho={24} />
      </button>
      {BARRA.slice(2).map(item)}
    </nav>
  );
}
