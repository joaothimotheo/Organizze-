import {
  aplicarEscolha,
  contarRapido,
  corpoEdicao,
  filaRapida,
  sobraParte,
  efeitoVinculo,
  lerLigacao,
  lerPartes,
  naturezaParaGrupo,
  opcaoDaEscolha,
  opcoesVinculo,
  pedeQuemRapido,
  textoLigacao,
  type Edicao,
} from "../src/movimentos";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------- natureza ao escolher grupo ----------
ok(naturezaParaGrupo({ valor: -10, natureza: "despesa" }) === "despesa", "gasto continua gasto");
ok(naturezaParaGrupo({ valor: 10, natureza: "estorno" }) === "estorno", "estorno continua estorno");
ok(naturezaParaGrupo({ valor: -10, natureza: "transferencia_interna" }) === "despesa", "transferência negativa vira gasto");
ok(naturezaParaGrupo({ valor: 10, natureza: "resgate_investimento" }) === "receita", "resgate positivo vira entrada");

const transf = { valor: -100, natureza: "transferencia_interna" };
ok(igual(aplicarEscolha(transf, { categoria: "a_classificar", natureza: "transferencia_interna" }, "cat:g_casa", true), { categoria: "g_casa", natureza: "despesa" }), "migrado: grupo devolve a gasto");
ok(igual(aplicarEscolha(transf, { categoria: "transferencias", natureza: "transferencia_interna" }, "cat:mercado", false), { categoria: "mercado", natureza: "transferencia_interna" }), "sem migrar: só a categoria");
ok(igual(aplicarEscolha({ valor: -5, natureza: "despesa" }, { categoria: "g", natureza: "despesa" }, "nat:aporte_investimento", true), { categoria: "g", natureza: "aporte_investimento" }), "natureza que não conta");
ok(opcaoDaEscolha({ categoria: "a_classificar", natureza: "aporte_investimento" }, true) === "nat:aporte_investimento", "migrado: não conta marca a natureza");
ok(opcaoDaEscolha({ categoria: "investimentos", natureza: "aporte_investimento" }, false) === "cat:investimentos", "sem migrar: marca a categoria");
ok(opcaoDaEscolha({ categoria: "", natureza: "despesa" }, true) === "cat:a_classificar", "sem categoria");

// ---------- vínculo ----------
ok(textoLigacao({ tipo: "pessoa", id: "e1" }) === "pessoa:e1" && textoLigacao(null) === "", "texto do vínculo");
ok(igual(lerLigacao("fixa:f:1"), { tipo: "fixa", id: "f:1" }) && lerLigacao("") === null && lerLigacao("outro:x") === null, "lê o vínculo");

const fontes = {
  dividas: [
    { id: "d1", credor: "Banco A", nome: null, saldos: [], situacao: "ativa", origem: { tipo: "informado" } },
    { id: "d2", credor: "Banco B", nome: "Carro", saldos: [], situacao: "ativa", origem: { tipo: "documento" }, tipo: "emprestimo" },
    { id: "d3", credor: "Banco C", nome: "Quitada", saldos: [], situacao: "quitada", origem: { tipo: "informado" } },
    { id: "d4", credor: "Cartão", nome: null, saldos: [], situacao: "ativa", origem: { tipo: "documento" }, tipo: "cartao_de_credito" },
  ],
  emprestimos: [
    { id: "e1", pessoa: "Ana", direcao: "eu_devo", valor: 100, data: "2026-10-01", pagamentos: [], situacao: "aberto" },
    { id: "e2", pessoa: "Bia", direcao: "me_deve", valor: 50, data: "2026-10-01", pagamentos: [], situacao: "aberto", descricao: "celular" },
    { id: "e3", pessoa: "Caio", direcao: "eu_devo", valor: 10, data: "2026-10-01", pagamentos: [], situacao: "quitado" },
  ],
  fixas: [
    { id: "f1", nome: "Aluguel", valor: 1000, forma: "pix", ativa: true },
    { id: "f2", nome: "Academia", valor: 90, forma: "cartao", ativa: false },
  ],
} as never;
const og = opcoesVinculo({ valor: -50 }, fontes);
ok(igual(og.map((g) => g.grupo), ["Dívidas", "Pessoas", "Contas fixas"]), "grupos de vínculo", og);
ok(igual(og[0].itens.map((i) => i.nome), ["Banco A", "Carro"]), "dívida: nome ou credor; sem quitadas e sem a fatura do cartão do banco", og[0].itens);
ok(igual(og[1].itens, [{ valor: "pessoa:e1", nome: "Ana (você deve)" }]), "gasto: só quem você deve, em aberto", og[1]);
ok(igual(og[2].itens.map((i) => i.valor), ["fixa:f1"]), "só fixas ativas");
const oe = opcoesVinculo({ valor: 50 }, fontes);
ok(igual(oe.map((g) => g.grupo), ["Pessoas", "Contas fixas"]), "entrada: nenhuma dívida", oe);
ok(igual(oe[0].itens, [{ valor: "pessoa:e2", nome: "Bia: celular (te deve)" }]), "entrada: só quem te deve", oe[0]);
const atualD = opcoesVinculo({ valor: -50, vinculo: { tipo: "divida", id: "d3" } }, fontes);
ok(atualD[0].itens.some((i) => i.valor === "divida:d3"), "dívida atual aparece mesmo quitada");
const atual = opcoesVinculo({ valor: -50, vinculo: { tipo: "fixa", id: "f2" } }, fontes);
ok(atual[2].itens.some((i) => i.valor === "fixa:f2"), "vínculo atual aparece mesmo cancelado");
const atualP = opcoesVinculo({ valor: -50, vinculo: { tipo: "pessoa", id: "e3" } }, fontes);
ok(atualP[1].itens.some((i) => i.valor === "pessoa:e3"), "pessoa atual aparece mesmo quitada");
const semNada = opcoesVinculo({ valor: 50 }, { dividas: [], emprestimos: [], fixas: [] });
ok(semNada.length === 0, "sem opções, sem grupos");
ok(efeitoVinculo("fixa", false, false).includes("paga"), "efeito fixa");
ok(efeitoVinculo("pessoa", true, false).includes("te pagou") && efeitoVinculo("pessoa", false, false).includes("você pagou"), "efeito pessoa por sentido");
ok(efeitoVinculo("divida", false, false) === "Baixa uma parcela (ou abate o saldo) desta dívida. Pagamentos de antes do saldo que você informou só entram no histórico.", "efeito dívida", efeitoVinculo("divida", false, false));
ok(efeitoVinculo(null, false, true).includes("desfaz") && efeitoVinculo(null, false, true).includes("baixa na dívida"), "desligar avisa que desfaz, inclusive na dívida", efeitoVinculo(null, false, true));

// ---------- partes ----------
const p1 = lerPartes(-312.45, [{ valor: "250", categoria: "g_comida" }, { valor: "62,45", categoria: "g_casa" }]);
ok(p1.ok && igual(p1.partes, [{ valor: -250, categoria: "g_comida" }, { valor: -62.45, categoria: "g_casa" }]), "312,45 em 250 + 62,45 com sinal do lançamento", p1);
const p2 = lerPartes(-312.45, [{ valor: "250", categoria: "g" }, { valor: "60", categoria: "g" }]);
ok(!p2.ok && p2.aviso === "As partes somam R$ 310,00, falta R$ 2,45.", "falta", p2.aviso);
const p3 = lerPartes(100, [{ valor: "100", categoria: "g" }, { valor: "", categoria: "g" }]);
ok(!p3.ok && p3.aviso.startsWith("Preencha"), "parte vazia");
ok(!lerPartes(100, [{ valor: "100", categoria: "g" }]).ok, "uma parte só não vale");
ok(!lerPartes(11, Array.from({ length: 11 }, () => ({ valor: "1", categoria: "g" }))).ok, "11 partes não vale");
const p4 = lerPartes(-10, [{ valor: "-4", categoria: "g", subcategoria: "Pão" }, { valor: "6", categoria: "" }]);
ok(p4.ok && igual(p4.partes, [{ valor: -4, categoria: "g", subcategoria: "Pão" }, { valor: -6, categoria: "a_classificar" }]), "sinal digitado é ignorado; sem categoria = a classificar", p4);

// ---------- corpo do PATCH: só o que mudou ----------
const mov = {
  id: "m1",
  data: "2026-11-10",
  descricao: "PIX ANA",
  valor: -312.45,
  natureza: "despesa",
  categoria: "g_comida",
  vinculo: { tipo: "pessoa", id: "e1", pagamento_id: "lanc-m1" },
} as never as import("../src/api").Movimentacao;
const base = (e: Partial<Edicao> = {}): Edicao => ({ nome: "", categoria: "g_comida", natureza: "despesa", partes: null, vinculo: { tipo: "pessoa", id: "e1" }, ...e });
ok(corpoEdicao(mov, base(), true) === null, "nada mudou");
ok(igual(corpoEdicao(mov, base({ nome: "  Aluguel " }), true), { nome: "Aluguel" }), "só o nome");
ok(igual(corpoEdicao({ ...mov, nome: "X" }, base({ nome: "" }), true), { nome: "" }), "nome vazio volta ao do banco");
ok(igual(corpoEdicao(mov, base({ categoria: "g_casa" }), true), { categoria: "g_casa" }), "só a categoria");
ok(igual(corpoEdicao(mov, base({ vinculo: null }), true), { vinculo: null }), "desligar");
ok(igual(corpoEdicao(mov, base({ vinculo: { tipo: "fixa", id: "f1" } }), true), { vinculo: { tipo: "fixa", id: "f1" } }), "trocar o vínculo");
ok(corpoEdicao({ ...mov, vinculo: null }, base({ vinculo: undefined }), true) === null, "janela sem vínculo não mexe nele");
const partes = [{ valor: -250, categoria: "g_comida" }, { valor: -62.45, categoria: "g_casa" }];
ok(igual(corpoEdicao(mov, base({ partes, nome: "Mercado" }), true), { nome: "Mercado", partes }), "dividir manda as partes (sem categoria) num PATCH só");
ok(corpoEdicao({ ...mov, partes }, base({ partes: partes.map((p) => ({ ...p })) }), true) === null, "mesmas partes não vão");
ok(igual(corpoEdicao({ ...mov, partes }, base(), true), { partes: null }), "desfazer divisão");
ok(igual(corpoEdicao({ ...mov, partes }, base({ categoria: "g_casa" }), true), { partes: null, categoria: "g_casa" }), "desfazer e escolher outra categoria");
ok(
  igual(corpoEdicao(mov, base({ natureza: "aporte_investimento" }), true), { natureza: "aporte_investimento" }),
  "migrado: não conta leva só a natureza",
);
const tr = { ...mov, natureza: "transferencia_interna", categoria: "a_classificar", vinculo: null } as typeof mov;
ok(igual(corpoEdicao(tr, base({ natureza: "despesa", categoria: "g_casa", vinculo: undefined }), true), { natureza: "despesa", categoria: "g_casa" }), "volta a gasto com grupo");
ok(
  igual(corpoEdicao({ ...tr, categoria: "transferencias" }, base({ natureza: "transferencia_interna", categoria: "investimentos", vinculo: undefined }), false), { categoria: "investimentos" }),
  "sem migrar: categoria muda mesmo no que não conta",
);
ok(igual(corpoEdicao(mov, base({ quem: " Ana " }), true), { quem: "Ana" }), "quem");
ok(igual(corpoEdicao({ ...mov, quem: "Ana" }, base({ quem: "" }), true), { quem: "" }), "quem vazio apaga");

// ---------- modo rápido ----------
ok(pedeQuemRapido({ natureza: "receita", descricao: "TED" }), "entrada pede quem");
ok(pedeQuemRapido({ natureza: "despesa", descricao: "Pix enviado Ana" }), "pix pede quem");
ok(!pedeQuemRapido({ natureza: "despesa", descricao: "MERCADO PIX" }), "pix no meio não pede");

// fila sem os divididos (mesmo com parte pendente)
const pend = (id: string, data: string, extra: object = {}) => ({ id, data, descricao: "X", valor: -10, natureza: "despesa", categoria: "a_classificar", ...extra }) as never;
ok(
  igual(filaRapida([pend("b", "2026-11-02"), pend("a", "2026-11-01"), pend("d", "2026-11-03", { partes: [{ valor: -6, categoria: "g" }, { valor: -4, categoria: "a_classificar" }] })]), ["a", "b"]),
  "fila rápida: mais antigos primeiro, sem os divididos",
);

// contagem: pulado que depois foi resolvido pela mesma descrição sai dos pulados
const c1 = contarRapido(["a", "b", "c"], new Set(["c", "a", "zz"]), new Set(["a", "b"]));
ok(c1.feitos === 2 && c1.pulados === 1, "pulado resolvido conta como organizado", c1);
const c2 = contarRapido(["a", "b"], new Set(["a", "b"]), new Set(["a", "b"]));
ok(c2.feitos + c2.pulados <= 2, "nunca passa do total", c2);

// 2ª parte acompanha a 1ª
ok(sobraParte(-312.45, "250") === "62,45", "sobra 62,45");
ok(sobraParte(-312.45, "") === "" && sobraParte(-312.45, "400") === "" && sobraParte(-312.45, "312,45") === "", "sem sobra, vazio");

if (falhas) {
  console.error(`${falhas} falha(s)`);
  process.exit(1);
}
console.log("todos passaram");
