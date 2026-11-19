import { abaDoCelular, contarPendentes, destinoPendentes, enderecoCanonico, lerValor, mesVizinho, periodoDoLancamento, MENU_FIM, MENU_MAIS, MENU_ORGANIZAR, MENU_PRINCIPAL, telaDoEndereco } from "../src/navegacao";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}

ok(telaDoEndereco("#visao").tela === "inicio", "visao vira inicio");
ok(JSON.stringify(telaDoEndereco("#gastos/mercado")) === JSON.stringify({ tela: "movimentos", detalhe: "mercado" }), "gastos/mercado");
ok(JSON.stringify(telaDoEndereco("#movimentos/mercado/mes-a-mes")) === JSON.stringify({ tela: "movimentos", detalhe: "mercado/mes-a-mes" }), "mês a mês fica em Movimentos");
ok(telaDoEndereco("#qualquer").tela === "inicio", "desconhecido");
ok(telaDoEndereco("").tela === "inicio", "vazio");
ok(telaDoEndereco("#enviar").tela === "ajustes" && telaDoEndereco("metas").tela === "objetivos", "enviar e metas");
ok(enderecoCanonico("#gastos/mercado") === "#movimentos/mercado", "canônico antigo");
ok(enderecoCanonico("#dividas") === null, "canônico já certo");
ok(enderecoCanonico("#xyz") === "#inicio" && enderecoCanonico("") === "#inicio", "canônico de desconhecido e vazio");
ok(telaDoEndereco("#analises").tela === "analises" && enderecoCanonico("#analises") === null, "endereço das análises");
ok(abaDoCelular("analises") === "mais", "análises fica em Mais no celular");
ok(abaDoCelular("dividas") === "mais" && abaDoCelular("salarios") === "mais" && abaDoCelular("objetivos") === "objetivos", "aba do celular");
ok(JSON.stringify(mesVizinho(2026, 12, 1)) === JSON.stringify({ ano: 2027, mes: 1 }), "dez → jan");
ok(JSON.stringify(mesVizinho(2026, 1, -1)) === JSON.stringify({ ano: 2025, mes: 12 }), "jan → dez");
ok(JSON.stringify(mesVizinho(2026, null, 1)) === JSON.stringify({ ano: 2027, mes: null }), "ano inteiro anda por ano");
const movs = [
  { natureza: "despesa", categoria: "a_classificar", data: "2026-11-03" },
  { natureza: "receita", categoria: null, data: "2026-11-05" },
  { natureza: "despesa", categoria: "a_classificar", data: "2026-10-30", competencia: "2026-11" },
  { natureza: "transferencia_interna", categoria: "a_classificar", data: "2026-11-06" },
  { natureza: "despesa", categoria: "mercado", data: "2026-11-07" },
  { natureza: "despesa", categoria: "a_classificar", data: "2026-10-02" },
];
ok(contarPendentes(movs, 2026, 11) === 3, "pendentes do mês (usa competência, ignora transferência)");
ok(contarPendentes(movs, 2026, null) === 4, "pendentes do ano");
ok(destinoPendentes() === "#movimentos/pendentes", "destino dos pendentes: Movimentos, aba Tudo, só os sem categoria");
ok(lerValor("1.234,56") === 1234.56 && lerValor("12,5") === 12.5 && lerValor("12.50") === 12.5 && lerValor("1.234") === 1234, "valores");
ok(lerValor("1,234.56") === null && lerValor("1.234,5.6") === null, "ponto depois da vírgula é inválido");
ok(lerValor("0,001") === null && lerValor("0,004") === null && lerValor("0,01") === 0.01, "zero depois de arredondar é inválido");
ok(lerValor("2.000.000,00") === 2000000, "valor acima do teto é lido (o teto é do formulário)");
ok(lerValor("abc") === null && lerValor("") === null && lerValor("0") === null && lerValor("-5") === null, "valores inválidos");
ok(periodoDoLancamento("2026-11-05", 2026, 11) === null, "período: lançamento no mês visto");
ok(JSON.stringify(periodoDoLancamento("2026-10-28", 2026, 11)) === JSON.stringify({ ano: 2026, mes: 10 }), "período: outro mês");
ok(JSON.stringify(periodoDoLancamento("2025-12-31", 2026, 1)) === JSON.stringify({ ano: 2025, mes: 12 }), "período: outro ano");
ok(periodoDoLancamento("2026-03-10", 2026, null) === null, "período: ano inteiro do mesmo ano");
ok(JSON.stringify(periodoDoLancamento("2025-03-10", 2026, null)) === JSON.stringify({ ano: 2025, mes: 3 }), "período: ano inteiro de outro ano");
ok(periodoDoLancamento("lixo", 2026, 11) === null, "período: data inválida");

const nomes = (m: [string, string][]) => m.map(([t]) => t).join(",");
ok(nomes(MENU_PRINCIPAL) === "inicio,movimentos,dividas,objetivos,analises", "menu principal");
ok(nomes(MENU_ORGANIZAR) === "fixas,pessoas", "menu organizar");
ok(nomes(MENU_FIM) === "categorias,salarios,ajustes", "menu fim");
ok(nomes(MENU_MAIS) === "dividas,analises,fixas,pessoas,categorias,ajustes,salarios", "menu mais");

if (falhas) {
  console.error(`${falhas} falha(s)`);
  process.exit(1);
}
console.log("todos passaram");
