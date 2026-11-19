import { ehEntrada, ehGasto, lerDetalhes, naoConta, NATUREZAS_NAO_CONTA, proximaCor, semCategoria, tipoDaNatureza, usoNoPeriodo } from "../src/grupos";
import { opcoesCategoria, registrarCategorias } from "../src/formato";
import { resumoPorCategoria } from "../src/gastos";
import { sugestoes } from "../src/fixas";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}

ok(ehEntrada({ natureza: "estorno" }) === true, "estorno é entrada");
ok(ehEntrada({ natureza: "receita" }) === true, "receita é entrada");
ok(ehGasto({ natureza: "estorno" }) === false, "estorno não é gasto");
ok(ehGasto({ natureza: "despesa" }) === true, "despesa é gasto");
ok(naoConta({ natureza: "emprestimo_concedido" }) === true, "empréstimo concedido não conta");
ok(naoConta({ natureza: "emprestimo_devolvido" }) === true, "empréstimo devolvido não conta");
ok(naoConta({ natureza: "despesa" }) === false && naoConta({ natureza: "estorno" }) === false, "gasto e entrada contam");
ok(semCategoria({ natureza: "transferencia_interna", categoria: "a_classificar" }) === false, "transferência não precisa de categoria");
ok(semCategoria({ natureza: "despesa", categoria: null }) === true, "despesa sem categoria");
ok(semCategoria({ natureza: "estorno", categoria: "a_classificar" }) === true, "estorno a classificar");
ok(semCategoria({ natureza: "despesa", categoria: "mercado" }) === false, "despesa com categoria");
ok(NATUREZAS_NAO_CONTA.saida.length === 4 && NATUREZAS_NAO_CONTA.entrada.length === 4, "quatro de cada lado");
ok(NATUREZAS_NAO_CONTA.saida.every(([n]) => naoConta({ natureza: n })) && NATUREZAS_NAO_CONTA.entrada.every(([n]) => naoConta({ natureza: n })), "todas as listadas não contam");

const l = (natureza: string, valor: number, categoria = "mercado") => ({ data: "2026-11-03", descricao: "X", valor, natureza, categoria });
const r = resumoPorCategoria([l("despesa", -100), l("estorno", 30)], ["2026-11"]);
ok(r.length === 1 && r[0].total === 100, "estorno não abate o gasto", r);

const compra = (d: string, desc: string, categoria: string) =>
  ({ id: d + desc, data: d, descricao: desc, valor: -20, natureza: "despesa", categoria, competencia: d.slice(0, 7), conta_id: "c" }) as never;
const movs = [compra("2026-11-02", "STREAMING X", "g1"), compra("2026-10-02", "STREAMING X", "g1")];
const grupos = [{ id: "g1", nome: "Assinaturas", tipo: "gasto" as const, cor: "#000", detalhes: [], pede_pessoa: false, padrao: false }];
ok(sugestoes(movs, [], "2026-11", new Map(), [], grupos).length === 1, "grupo Assinaturas sugere conta fixa");
ok(sugestoes(movs, [], "2026-11", new Map(), []).length === 0, "sem a lista de grupos não sugere");

// ---------- Task 5: telas de categorias ----------
ok(tipoDaNatureza("despesa") === "gasto" && tipoDaNatureza("estorno") === "entrada" && tipoDaNatureza("receita") === "entrada", "tipo pela natureza");
ok(tipoDaNatureza("transferencia_interna") === undefined && tipoDaNatureza(null) === undefined, "transferência não tem tipo");
ok(proximaCor([]) === "g1" && proximaCor(["g1", "g2"]) === "g3", "próxima cor livre");
ok(proximaCor(["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g1"]) === "g2", "todas usadas: gira");
ok(JSON.stringify(lerDetalhes(" Combustível,  Manutenção ,, IPVA  e seguro ")) === JSON.stringify(["Combustível", "Manutenção", "IPVA e seguro"]), "detalhes por vírgula");
const usos = usoNoPeriodo(
  [
    { data: "2026-11-03", valor: -100, natureza: "despesa", categoria: "p_carro" },
    { data: "2026-10-30", competencia: "2026-11", valor: -50, natureza: "despesa", categoria: "p_carro" },
    { data: "2026-10-03", valor: -7, natureza: "despesa", categoria: "p_carro" },
    { data: "2026-11-05", valor: 30, natureza: "estorno", categoria: "rendimentos_estornos" },
  ],
  2026,
  11,
);
ok(usos.get("p_carro")?.vezes === 2 && usos.get("p_carro")?.valor === 150, "uso no mês pela competência", usos);
ok(usos.get("rendimentos_estornos")?.valor === 30, "uso em valor absoluto");
ok(usoNoPeriodo([{ data: "2026-10-03", valor: -7, natureza: "despesa", categoria: "x" }], 2026, null).get("x")?.vezes === 1, "ano inteiro");
registrarCategorias([
  { id: "p_carro", nome: "Carro", tipo: "gasto" },
  { id: "outros", nome: "Outros gastos", tipo: "gasto" },
  { id: "salario", nome: "Salário", tipo: "entrada" },
]);
ok(opcoesCategoria("gasto").map(([k]) => k).join() === "p_carro,outros", "despesa só vê grupos de gasto");
ok(opcoesCategoria("entrada").map(([k]) => k).join() === "salario", "receita e estorno só veem entradas");
ok(opcoesCategoria().length === 3, "sem tipo, todos");
registrarCategorias([{ id: "mercado", nome: "Mercado" }, { id: "salario", nome: "Salário" }]);
ok(opcoesCategoria("gasto").length === 2, "categorias antigas não têm tipo: sem filtro");

if (falhas) process.exit(1);
console.log("todos passaram");
