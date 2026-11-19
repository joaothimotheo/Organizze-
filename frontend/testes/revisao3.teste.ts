/** Correções da revisão final da fase 3 (Movimentos). */
import { corpoEdicao, filtrar, FILTRO_VAZIO, linhasAoDividir, linkDetalhes, opcoesDetalhe, pendente, rotaMovimentos } from "../src/movimentos";
import { gastoPorParte, temCategoria } from "../src/gastos";
import { lancamentosPorGrupo } from "../src/grupos";
import type { Movimentacao } from "../src/api";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const mov = (extra: Partial<Movimentacao> = {}): Movimentacao => ({ id: "m1", data: "2026-11-10", descricao: "MERCADO", valor: -312.45, natureza: "despesa", categoria: "g_casa", ...extra });
const dividido = mov({
  id: "d1",
  partes: [
    { valor: -250, categoria: "g_comida" },
    { valor: -62.45, categoria: "g_casa", subcategoria: "Luz" },
  ],
});

// ---------- 1. Início e mês a mês somam por parte ----------
ok(temCategoria(dividido, "g_casa") && temCategoria(dividido, "g_comida") && !temCategoria(dividido, "g_lazer"), "lista mostra o dividido em cada grupo das partes");
ok(temCategoria(mov(), "g_casa") && temCategoria(mov({ categoria: null }), "a_classificar"), "sem partes: a categoria inteira");
const soma = gastoPorParte([dividido, mov({ id: "m2", valor: -10 }), mov({ id: "e", valor: 99, natureza: "receita", categoria: "salario" })]);
ok(soma.get("g_comida") === 250 && soma.get("g_casa") === 72.45 && !soma.has("salario"), "soma por parte, só gastos", [...soma]);

// ---------- 2. link para os detalhes em Movimentos ----------
const link = linkDetalhes("pluggy/a b");
ok(link.startsWith("#movimentos/lancamento/"), "link dos detalhes", link);
const r = rotaMovimentos(decodeURIComponent(link), []);
ok(r.abrir === "pluggy/a b" && r.filtro.aba === "tudo", "endereço abre os detalhes daquele lançamento", r);
ok(rotaMovimentos("#movimentos/tudo", []).abrir === null, "outros endereços não abrem nada");

// ---------- 3. detalhe (subcategoria) ----------
const comLuz = mov({ subcategoria: "Luz" });
ok(igual(corpoEdicao(mov(), { categoria: "g_casa", natureza: "despesa", partes: null, subcategoria: "Luz" }, true), { categoria: "g_casa", subcategoria: "Luz" }), "só o detalhe mudou: manda categoria + detalhe");
ok(igual(corpoEdicao(comLuz, { categoria: "g_casa", natureza: "despesa", partes: null, subcategoria: null }, true), { categoria: "g_casa", subcategoria: "" }), "Nenhum: limpa o detalhe");
ok(corpoEdicao(comLuz, { categoria: "g_casa", natureza: "despesa", partes: null, subcategoria: " Luz " }, true) === null, "mesmo detalhe: nada mudou");
ok(igual(corpoEdicao(comLuz, { categoria: "g_comida", natureza: "despesa", partes: null, subcategoria: null }, true), { categoria: "g_comida", subcategoria: "" }), "outro grupo, sem detalhe");
ok(igual(corpoEdicao(comLuz, { categoria: "g_comida", natureza: "despesa", partes: null }, true), { categoria: "g_comida" }), "janela que não mexe no detalhe: como antes");
ok(igual(corpoEdicao(comLuz, { categoria: "g_casa", natureza: "aporte_investimento", partes: null, subcategoria: "Luz" }, true), { natureza: "aporte_investimento" }), "não conta no mês: só a natureza");
ok(igual(opcoesDetalhe(["Luz", "Água"], null), ["Luz", "Água"]), "detalhes do grupo");
ok(igual(opcoesDetalhe(["Luz"], "Gás"), ["Luz", "Gás"]) && igual(opcoesDetalhe(undefined, "Luz"), ["Luz"]) && igual(opcoesDetalhe(["Luz"], "Luz"), ["Luz"]), "o detalhe atual aparece mesmo fora da lista");

// ---------- 4. pendentes inclui dividido com parte pendente ----------
const comPendente = mov({ id: "p1", categoria: "g_casa", partes: [{ valor: -300, categoria: "g_casa" }, { valor: -12.45, categoria: "a_classificar" }] });
ok(pendente(comPendente) && pendente(mov({ categoria: "a_classificar" })) && !pendente(dividido) && !pendente(mov({ natureza: "transferencia_interna", categoria: null })), "pendente: sem grupo ou com parte sem grupo");
ok(igual(filtrar([comPendente, dividido], { ...FILTRO_VAZIO, aba: "tudo", soPendentes: true }, () => "").map((m) => m.id), ["p1"]), "lista de pendentes mostra o dividido com parte pendente");

// ---------- 6. endereço da fase 2 ----------
const ac = rotaMovimentos("#movimentos/a_classificar", []);
ok(ac.filtro.aba === "tudo" && ac.filtro.soPendentes === true, "#movimentos/a_classificar = pendentes", ac);
ok(rotaMovimentos("#movimentos/a_classificar/mes-a-mes", []).mesAMes === "a_classificar", "Sem categoria mês a mês abre a análise, não os pendentes");
ok(!rotaMovimentos("#movimentos/a_classificar/mes-a-mes", []).filtro.soPendentes, "mês a mês não liga só pendentes");

// ---------- 8. contagem por grupo inclui partes ----------
const cont = lancamentosPorGrupo([dividido, mov({ id: "m2" }), mov({ id: "m3", categoria: "g_casa", partes: [{ valor: -1, categoria: "g_casa" }, { valor: -311.45, categoria: "g_casa" }] })]);
ok(cont.get("g_casa") === 3 && cont.get("g_comida") === 1, "cada lançamento conta uma vez em cada grupo das partes", [...cont]);

// ---------- 9. dividir herda o detalhe ----------
ok(igual(linhasAoDividir("g_casa", "Luz"), [{ valor: "", categoria: "g_casa", subcategoria: "Luz" }, { valor: "", categoria: "a_classificar" }]), "1ª parte herda o detalhe");
ok(igual(linhasAoDividir("g_casa", null), [{ valor: "", categoria: "g_casa", subcategoria: null }, { valor: "", categoria: "a_classificar" }]), "sem detalhe");

if (falhas) {
  console.error(`${falhas} falha(s)`);
  process.exit(1);
}
