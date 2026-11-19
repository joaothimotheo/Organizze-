import { Icone } from "../componentes/Menu";
import { MENU_MAIS, type Tela } from "../navegacao";

const DESCRICAO: Partial<Record<Tela, string>> = {
  dividas: "Empréstimos, parcelados e o plano para quitar",
  analises: "Gráficos que respondem uma pergunta cada",
  fixas: "Aluguel, luz, assinaturas",
  pessoas: "Quem te deve e a quem você deve",
  categorias: "Grupos de gasto e origens de entrada",
  ajustes: "Tema, bancos, documentos e sair",
  salarios: "Holerites e descontos",
};

/** Tela "Mais" do celular: o que não cabe na barra de baixo. */
export default function Mais() {
  return (
    <section className="panel mais-lista" aria-label="Mais">
      {MENU_MAIS.map(([id, nome]) => (
        <a key={id} href={`#${id}`}>
          <Icone nome={id} tamanho={20} />
          <span className="mais-texto">
            <b>{nome}</b>
            <small>{DESCRICAO[id]}</small>
          </span>
          <Icone nome="dir" />
        </a>
      ))}
    </section>
  );
}
