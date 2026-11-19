import { conferirPartes, doPeriodo, filaRapida, filtrar, FILTRO_VAZIO, normalizar, partesDe, porDia, resumo, rotaMovimentos, type Filtro } from "../src/movimentos";
import { resumoPorCategoria } from "../src/gastos";
import { usoNoPeriodo } from "../src/grupos";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}

const m = (id: string, data: string, descricao: string, valor: number, natureza: string, categoria: string | null, extra: object = {}) =>
  ({ id, data, descricao, valor, natureza, categoria, conta_id: "c1", ...extra }) as never;
const movs = [
  m("1", "2026-11-10", "FARMÁCIA CENTRAL", -45.5, "despesa", "saude"),
  m("2", "2026-11-10", "SUPERMERCADO ABC", -320, "despesa", "mercado"),
  m("3", "2026-11-09", "UBER TRIP", -22, "despesa", "a_classificar"),
  m("4", "2026-11-08", "SALARIO", 5000, "receita", "salario"),
  m("5", "2026-11-07", "PIX PARA POUPANCA", -1000, "transferencia_interna", null),
  m("6", "2026-11-06", "ESTORNO LOJA", 80, "estorno", "a_classificar"),
  m("7", "2026-11-05", "Padaria", -12, "despesa", null, { conta_id: "dinheiro", nome: "Pão" }),
  m("8", "2026-11-04", "RESTAURANTE", -312.45, "despesa", "alimentacao", {
    quem: "Ana",
    partes: [{ valor: -250, categoria: "alimentacao" }, { valor: -62.45, categoria: "mercado" }],
  }),
  m("9", "2026-11-03", "CINEMA", -60, "despesa", "lazer", { conta_id: "c2" }),
  m("10", "2026-11-02", "FREELA", 700, "receita", "outras_receitas", { conta_id: "c2" }),
  m("11", "2026-11-01", "PEDÁGIO", -8, "despesa", "transporte", { conta_id: null }),
  m("12", "2026-10-30", "CONTA DE LUZ", -150, "despesa", "contas_casa"),
];
const nomeConta = (id?: string | null) => ({ c1: "Nubank", c2: "Itaú" })[id ?? ""] ?? "Dinheiro";
const f = (p: Partial<Filtro>): Filtro => ({ ...FILTRO_VAZIO, ...p });
const ids = (l: { id: string }[]) => l.map((x) => x.id).join(",");

ok(ids(filtrar(movs, f({ aba: "entradas" }), nomeConta)) === "4,6,10", "aba entradas");
ok(ids(filtrar(movs, f({ aba: "saidas" }), nomeConta)) === "1,2,3,7,8,9,11,12", "aba saídas");
ok(filtrar(movs, f({ aba: "tudo" }), nomeConta).length === 12, "aba tudo inclui transferência");
ok(ids(filtrar(movs, f({ aba: "tudo", busca: "farmacia" }), nomeConta)) === "1", "busca sem acento acha FARMÁCIA");
ok(ids(filtrar(movs, f({ aba: "tudo", busca: "pao" }), nomeConta)) === "7", "busca no nome");
ok(ids(filtrar(movs, f({ aba: "tudo", busca: "ana" }), nomeConta)) === "8", "busca em quem");
ok(ids(filtrar(movs, f({ aba: "tudo", busca: "ITAU" }), nomeConta)) === "9,10", "busca no nome da conta");
ok(ids(filtrar(movs, f({ aba: "tudo", conta: "dinheiro" }), nomeConta)) === "7,11", "dinheiro: manual e sem conta");
ok(ids(filtrar(movs, f({ aba: "tudo", conta: "c2" }), nomeConta)) === "9,10", "filtro de conta");
ok(ids(filtrar(movs, f({ aba: "saidas", valorMin: 100 }), nomeConta)) === "2,8,12", "valor acima de 100");
ok(ids(filtrar(movs, f({ aba: "saidas", grupo: "mercado" }), nomeConta)) === "2,8", "grupo conta partes");
ok(ids(filtrar(movs, f({ aba: "tudo", soPendentes: true }), nomeConta)) === "3,6,7", "só pendentes");

const dias = porDia(movs);
ok(dias[0].dia === "2026-11-10" && dias[dias.length - 1].dia === "2026-10-30", "dias do mais recente ao mais antigo");
ok(ids(dias[0].itens) === "2,1", "no dia, maior valor primeiro");

ok(normalizar("  Farmácia   CENTRAL ") === "farmacia central", "normalizar");
ok(partesDe(movs[7]).length === 2, "partes somando valem");
ok(partesDe(m("x", "2026-11-01", "X", -100, "despesa", "mercado", { partes: [{ valor: -50, categoria: "lazer" }] })).length === 1, "partes que não fecham: categoria inteira");
ok(partesDe(movs[0])[0].categoria === "saude", "sem partes: uma só");

const grupos = ["saude", "mercado", "alimentacao", "lazer", "transporte", "contas_casa"].map((id) => ({ id, nome: id, tipo: "gasto" as const, cor: "g1", detalhes: [], pede_pessoa: false, padrao: false }));
const r = resumo(movs, grupos, "gasto");
ok(r[0].grupo.id === "mercado" && r[0].total === 382.45, "resumo divide em partes", r);
ok(r.find((x) => x.grupo.id === "alimentacao")?.total === 250, "resumo: parte de alimentação");
ok(r.length === 6, "resumo só grupos com valor");

ok(filaRapida(movs).join(",") === "7,6,3", "fila: pendentes, mais antigos primeiro", filaRapida(movs));

const c = conferirPartes(-312.45, [{ valor: -250 }, { valor: -62.44 }]);
ok(!c.ok && c.texto === "as partes somam R$ 312,44, falta R$ 0,01", "mensagem de falta", c);
ok(conferirPartes(-100, [{ valor: -60 }, { valor: -41 }]).texto === "as partes somam R$ 101,00, passa R$ 1,00", "mensagem de passa");
ok(conferirPartes(-312.45, [{ valor: -250 }, { valor: -62.45 }]).ok, "fecha no centavo");
ok(conferirPartes(-1312.45, [{ valor: -250 }, { valor: -1062.46 }]).texto === "as partes somam R$ 1.312,46, passa R$ 0,01", "mensagem com separador de milhar");

ok(ids(doPeriodo(movs, 2026, 11)) === "1,2,3,4,5,6,7,8,9,10,11", "período: mês pela data");
ok(ids(doPeriodo([...movs, m("13", "2026-10-31", "FATURA", -10, "despesa", "lazer", { competencia: "2026-11" })], 2026, 10)) === "12", "período: competência vale mais que a data");
ok(doPeriodo(movs, 2026, null).length === 12 && doPeriodo(movs, 2025, null).length === 0, "período: ano inteiro");

const gr = [...grupos, { id: "p_x", nome: "X", tipo: "gasto" as const, cor: "g1", detalhes: [], pede_pessoa: false, padrao: false }];
const a = rotaMovimentos("#movimentos/mercado", grupos);
ok(a.filtro.grupo === "mercado" && a.filtro.aba === "saidas", "rota de grupo", a);
ok(rotaMovimentos("#movimentos/p_x/mes-a-mes", gr).mesAMes === "p_x", "rota mês a mês");
const p = rotaMovimentos("#movimentos/pendentes", grupos);
ok(p.filtro.aba === "tudo" && p.filtro.soPendentes === true, "rota pendentes");
ok(rotaMovimentos("#movimentos", grupos).filtro.aba === "saidas", "rota padrão");
ok(rotaMovimentos("#movimentos/entradas", grupos).filtro.aba === "entradas", "rota entradas");
const ge = [{ ...grupos[0], id: "salario", tipo: "entrada" as const }];
ok(rotaMovimentos("#movimentos/salario", ge).filtro.aba === "entradas", "grupo de entrada abre entradas");
const semTipo = rotaMovimentos("#movimentos/mercado", [{ id: "mercado", nome: "Mercado" }] as never).filtro;
ok(semTipo.aba === "tudo" && semTipo.grupo === "mercado", "categoria sem tipo (antes de migrar) abre Tudo filtrada", semTipo);

// somas por categoria em gastos.ts e grupos.ts contam por parte
const rc = resumoPorCategoria(movs.map((x) => ({ ...(x as object), competencia: "2026-11" })) as never, ["2026-11"]);
ok(rc.find((x) => x.categoria === "alimentacao")?.total === 250 && rc.find((x) => x.categoria === "mercado")?.total === 382.45, "resumoPorCategoria por parte", rc);
const uso = usoNoPeriodo(movs as never, 2026, 11);
ok(uso.get("mercado")?.valor === 382.45 && uso.get("alimentacao")?.valor === 250, "usoNoPeriodo por parte");

if (falhas) {
  console.error(`${falhas} falha(s)`);
  process.exit(1);
}
