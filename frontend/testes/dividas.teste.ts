import type { Brutos, Divida, Emprestimo, Holerite, Movimentacao } from "../src/api";
import { depoisDoSaldoInformado, juntarDividas, ordemSugerida, resumo, simularAdiantar, sugestoesPagamento, tipoDaDivida, TIPOS_PADRAO, ultimoSaldoInformado, type DividaVista } from "../src/dividas";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}
const perto = (a: number | null | undefined, b: number, tol = 0.01) => a != null && Math.abs(a - b) <= tol;

const HOJE = "2026-11-19";

const div = (id: string, extra: Partial<Divida>): Divida => ({ id, credor: id, nome: id, situacao: "ativa", origem: { tipo: "informado" }, saldos: [], ...extra });
const mov = (id: string, data: string, descricao: string, valor: number, extra: Partial<Movimentacao> = {}): Movimentacao =>
  ({ id, data, descricao, valor, natureza: "despesa", conta_id: "c1", ...extra }) as Movimentacao;

const dividas: Divida[] = [
  div("d_emp", {
    nome: "Empréstimo do banco",
    tipo: "emprestimo",
    parcela_valor: 412.8,
    parcelas_total: 12,
    parcelas_restantes: 9,
    proximo_vencimento: "2026-11-25",
    taxa_mensal: 6.3,
    saldos: [{ data: "2026-10-24", saldo_devedor: 2771.44 }],
    pagamentos: [{ lancamento_id: "p1", data: "2026-10-24", valor: -412.8 }],
  }),
  div("d_sem", { nome: "Acordo da loja", tipo: "acordo", parcela_valor: 100, parcelas_total: 10, parcelas_restantes: 4, valor_contratado: 1000, proximo_vencimento: "2026-12-05", saldos: [{ data: "2026-11-05", saldo_devedor: 400 }] }),
  div("d_ipva", { nome: "IPVA", tipo: "ipva", vencimento_original: "2026-03-31", saldos: [{ data: "2026-03-01", saldo_devedor: 1500 }] }),
  div("d_loja", { nome: "Crediário", tipo: "t_loja", parcela_valor: 200, parcelas_restantes: 5, proximo_vencimento: "2026-11-10", saldos: [{ data: "2026-10-10", saldo_devedor: 1000 }] }),
  div("d_apagado", { nome: "Dívida antiga", tipo: "t_velho", saldos: [{ data: "2026-09-01", saldo_devedor: 300 }] }),
  div("d_quitada", { tipo: "emprestimo", situacao: "quitada", saldos: [{ data: "2026-09-01", saldo_devedor: 0 }] }),
  // Saldo da fatura do cartão vindo do banco: as parcelas já entram pelo cartão.
  { id: "divida-cc", credor: "Cartão", tipo: "cartao_de_credito", situacao: "ativa", saldos: [{ data: "2026-11-01", saldo_devedor: 2500 }] },
];

const emprestimos: Emprestimo[] = [
  { id: "e1", pessoa: "João", direcao: "eu_devo", valor: 1000, data: "2026-06-01", pagamentos: [{ id: "pg1", data: "2026-08-01", valor: 300, obs: "Pix" }], situacao: "aberto" },
  { id: "e2", pessoa: "Maria", direcao: "me_deve", valor: 500, data: "2026-06-01", pagamentos: [], situacao: "aberto" },
];

const movimentacoes: Movimentacao[] = [
  mov("p1", "2026-10-24", "PARCELA EMPRESTIMO", -412.8, { vinculo: { tipo: "divida", id: "d_emp" } }),
  // Compra parcelada no cartão: 3 de 10 na fatura de novembro (aberta).
  mov("k3", "2026-11-03", "LOJA X", -150, { conta_id: "cc", parcela: "3/10", competencia: "2026-11", data_compra: "2026-09-03", origem: { cartao_final: "1234" } }),
  mov("s1", "2026-11-22", "PARCELA EMPRESTIMO 412,80", -412.8),
  mov("s2", "2026-11-10", "PARCELA EMPRESTIMO 412,80", -412.8),
  mov("s3", "2026-11-24", "PARCELA EMPRESTIMO", -450),
  mov("s4", "2026-11-23", "PARCELA EMPRESTIMO", -412.8),
  mov("s5", "2026-11-26", "PARCELA EMPRESTIMO", -412.8, { vinculo: { tipo: "divida", id: "d_emp" } }),
  mov("s6", "2026-11-21", "TED RECEBIDA", 412.8, { natureza: "receita" }),
  mov("s7", "2026-11-21", "PARCELA EMPRESTIMO", -404),
];

const hol = (competencia: string, liquido: number): Holerite => ({ id: `h${competencia}`, competencia, proventos: [], descontos: [], bruto: liquido, total_descontos: 0, liquido });

const brutos = (extra: Partial<Brutos> = {}): Brutos =>
  ({
    holerites: [],
    movimentacoes,
    dividas,
    dividasTipos: [{ id: "t_loja", nome: "Loja" }],
    dividasRecusados: [{ divida: "d_emp", lancamento: "s4" }],
    documentos: [],
    descontosTemporarios: [],
    contas: [],
    emprestimos,
    categorias: [],
    metas: [],
    fixas: [],
    saldosContas: [],
    fixasIgnoradas: [],
    categoriasMigradas: true,
    ...extra,
  }) as Brutos;

// ---------- tipos ----------
ok(TIPOS_PADRAO.map((t) => t.id).join(",") === "cartao,emprestimo,pessoas,outras", "tipos padrão na ordem");
ok(TIPOS_PADRAO[0].nome === "Cartão parcelado" && TIPOS_PADRAO[3].nome === "Outras dívidas", "nomes dos tipos padrão");
const criados = [{ id: "t_loja" }];
ok(tipoDaDivida(div("a", { tipo: "emprestimo" }), criados) === "emprestimo", "empréstimo → Empréstimos");
ok(tipoDaDivida(div("a", { tipo: "financiamento" }), criados) === "emprestimo", "financiamento → Empréstimos");
ok(tipoDaDivida(div("a", { tipo: "cartao" }), criados) === "cartao", "cartao → Cartão parcelado");
ok(tipoDaDivida(div("a", { tipo: "cartao_de_credito" }), criados) === "cartao", "cartao_de_credito → Cartão parcelado");
ok(tipoDaDivida(div("a", { tipo: "t_loja" }), criados) === "t_loja", "tipo criado → ele");
ok(tipoDaDivida(div("a", { tipo: "t_velho" }), criados) === "outras", "tipo apagado → outras");
ok(tipoDaDivida(div("a", { tipo: "ipva" }), criados) === "outras", "ipva → outras");
ok(tipoDaDivida(div("a", { tipo: null }), criados) === "outras", "sem tipo → outras");
ok(tipoDaDivida(div("a", { tipo: "outras" }), criados) === "outras", "outras → outras");

// ---------- lista única ----------
const v = juntarDividas(brutos(), HOJE);
const por = (id: string) => v.find((x) => x.id === id) as DividaVista;
ok(!por("d_quitada") && !por("divida-cc"), "sem quitadas e sem o saldo da fatura do cartão", v.map((x) => x.id));
ok(v.length === 7, "7 dívidas: 5 cadastradas, 1 do cartão, 1 pessoa", v.map((x) => x.id));

const emp = por("d_emp");
ok(emp.origem === "cadastrada" && emp.tipo === "emprestimo" && emp.nome === "Empréstimo do banco", "empréstimo: origem, tipo e nome");
ok(emp.parcela === 412.8 && emp.restantes === 9 && emp.total === 12 && emp.pagas === 3, "empréstimo: 3 de 12 pagas", emp);
ok(perto(emp.taxa, 0.063, 1e-9), "empréstimo: taxa cadastrada em fração", emp.taxa);
ok(perto(emp.quitarHoje, 2771.44), "empréstimo: quitar hoje ≈ 2.771,44", emp.quitarHoje);
ok(perto(emp.ateOFim, 3715.2), "empréstimo: até o fim = 412,80 × 9", emp.ateOFim);
ok(perto(emp.juros, 943.76), "empréstimo: juros que faltam ≈ 943,76", emp.juros);
ok(emp.proxima?.valor === 412.8 && emp.proxima.data === "2026-11-25", "empréstimo: próxima parcela", emp.proxima);
ok(emp.fim === "2027-07", "empréstimo: última parcela em jul/27", emp.fim);
ok(!emp.atraso && emp.etiqueta === "juros_altos", "empréstimo: juros altos", emp.etiqueta);
ok(emp.pagamentos.length === 1 && emp.pagamentos[0].valor === 412.8 && emp.pagamentos[0].texto === "PARCELA EMPRESTIMO" && emp.pagamentos[0].data === "2026-10-24", "empréstimo: pagamento com o nome do lançamento", emp.pagamentos);

const sem = por("d_sem");
ok(sem.tipo === "outras" && sem.taxa === 0 && sem.etiqueta === "sem_juros", "parcelamento sem juros (taxa implícita 0)", sem);
ok(sem.quitarHoje === 400 && sem.ateOFim === 400 && sem.juros === 0, "sem juros: quitar hoje = soma", sem);
ok(sem.fim === "2027-03" && sem.pagas === 6, "sem juros: fim e pagas", sem);

const ipva = por("d_ipva");
ok(ipva.parcela === null && ipva.restantes === 0 && ipva.total === null && ipva.pagas === null && ipva.proxima === null, "IPVA sem parcelas", ipva);
ok(ipva.quitarHoje === 1500 && ipva.ateOFim === 1500 && ipva.juros === 0 && ipva.fim === null, "IPVA: saldo", ipva);
ok(ipva.atraso && ipva.etiqueta === "atraso" && ipva.taxa === null, "IPVA vencido em atraso", ipva);

const loja = por("d_loja");
ok(loja.tipo === "t_loja" && loja.taxa === null && loja.total === null && loja.pagas === null, "tipo criado, taxa desconhecida", loja);
ok(loja.atraso && loja.etiqueta === "atraso", "vencimento passou sem pagamento no mês: em atraso", loja);
ok(loja.quitarHoje === 1000 && loja.juros === 0 && loja.fim === "2027-03", "taxa desconhecida: quitar hoje = soma", loja);

const apagado = por("d_apagado");
ok(apagado.tipo === "outras" && !apagado.atraso && apagado.etiqueta === null && apagado.ateOFim === 300, "tipo apagado vai para outras", apagado);

const pessoa = v.find((x) => x.origem === "pessoa")!;
ok(!!pessoa && pessoa.tipo === "pessoas" && pessoa.nome === "João" && pessoa.ateOFim === 700 && pessoa.quitarHoje === 700, "pessoa eu_devo: 700", pessoa);
ok(pessoa.parcela === null && pessoa.etiqueta === "sem_juros" && pessoa.pagamentos.length === 1 && pessoa.pagamentos[0].valor === 300, "pessoa: sem parcelas, pagamentos do empréstimo", pessoa);
ok(!v.some((x) => x.nome === "Maria"), "quem me deve não entra");

const cartao = v.find((x) => x.origem === "cartao")!;
ok(!!cartao && cartao.tipo === "cartao" && cartao.nome === "LOJA X" && cartao.parcela === 150 && cartao.restantes === 8 && cartao.total === 10 && cartao.pagas === 2, "cartão: 8 de 10 faltando", cartao);
ok(cartao.ateOFim === 1200 && cartao.taxa === 0 && cartao.etiqueta === "sem_juros" && cartao.fim === "2027-07", "cartão: sem juros até jul/27", cartao);
ok(cartao.proxima?.valor === 150 && cartao.proxima.data === "2026-12", "cartão: próxima no mês da fatura", cartao.proxima);
ok(cartao.pagamentos.length === 1 && cartao.pagamentos[0].texto === "Parcela 3/10" && cartao.pagamentos[0].valor === 150, "cartão: parcelas vistas", cartao.pagamentos);

// Taxa implícita (sem taxa cadastrada): 100 × 12 sobre 1.000 ≈ 2,92% ao mês → sem etiqueta.
const impl = juntarDividas(brutos({ dividas: [div("i", { tipo: "financiamento", parcela_valor: 100, parcelas_total: 12, parcelas_restantes: 12, valor_contratado: 1000, proximo_vencimento: "2026-12-01" })], emprestimos: [], movimentacoes: [] }), HOJE)[0];
ok(perto(impl.taxa, 0.0292, 0.0005) && impl.etiqueta === null && impl.juros > 0, "taxa implícita", impl);
// Total do contrato menor que as restantes (dado incoerente): não calcula a taxa implícita.
const incoerente = juntarDividas(brutos({ dividas: [div("j", { parcela_valor: 100, parcelas_total: 5, parcelas_restantes: 12, valor_contratado: 400, proximo_vencimento: "2026-12-01" })], emprestimos: [], movimentacoes: [] }), HOJE)[0];
ok(incoerente.taxa === null, "total menor que as restantes: taxa desconhecida", incoerente.taxa);
// Ligar o pagamento avança o próximo vencimento: pago em novembro, o próximo é dezembro e não está em atraso.
const pago = juntarDividas(brutos({ dividas: [div("x", { parcela_valor: 50, parcelas_restantes: 2, proximo_vencimento: "2026-12-10", pagamentos: [{ lancamento_id: "z", data: "2026-11-09", valor: -50 }] })], emprestimos: [], movimentacoes: [] }), HOJE)[0];
ok(!pago.atraso, "pagamento ligado avançou o vencimento: sem atraso", pago);
// Próximo vencimento já passou: em atraso, mesmo com outro pagamento no mesmo mês (era a parcela anterior).
const doisNoMes = juntarDividas(brutos({ dividas: [div("x2", { parcela_valor: 50, parcelas_restantes: 2, proximo_vencimento: "2026-11-10", pagamentos: [{ lancamento_id: "z", data: "2026-11-09", valor: -50 }] })], emprestimos: [], movimentacoes: [] }), HOJE)[0];
ok(doisNoMes.atraso && doisNoMes.etiqueta === "atraso", "vencimento passado: em atraso mesmo com pagamento no mês", doisNoMes);
const marcada = juntarDividas(brutos({ dividas: [div("y", { situacao: "atrasada", saldos: [{ data: "2026-11-01", saldo_devedor: 80 }] })], emprestimos: [], movimentacoes: [] }), HOJE)[0];
ok(marcada.atraso && marcada.etiqueta === "atraso", "situação em atraso", marcada);
ok(juntarDividas(brutos({ dividas: [], emprestimos: [], movimentacoes: [] }), HOJE).length === 0, "sem nada: lista vazia");

// ---------- resumo ----------
const comHolerite = resumo(v, brutos({ holerites: [hol("2026-07", 1000), hol("2026-08", 4000), hol("2026-09", 5000), hol("2026-10", 6000)] }), HOJE);
ok(perto(comHolerite.deve, 8815.2), "você deve = Σ até o fim", comHolerite.deve);
ok(perto(comHolerite.juros, 943.76), "juros que faltam", comHolerite.juros);
ok(perto(comHolerite.parcelasDoMes, 862.8), "parcelas de dezembro: 412,80 + 100 + 200 + 150", comHolerite.parcelasDoMes);
ok(perto(comHolerite.peso, 862.8 / 5000, 1e-6), "peso sobre a média dos 3 últimos holerites", comHolerite.peso);
ok(comHolerite.livre === "2027-07" && comHolerite.semData === 3, "livre em jul/27; 3 sem data", comHolerite);

const salario = (id: string, data: string, valor: number) => mov(id, data, "SALARIO", valor, { natureza: "receita", categoria: "salario" });
const semHolerite = resumo(v, brutos({ movimentacoes: [...movimentacoes, salario("w8", "2026-08-05", 4500), salario("w9", "2026-09-05", 4500), salario("w10", "2026-10-05", 4500), salario("w11", "2026-11-05", 9999)] }), HOJE);
ok(perto(semHolerite.peso, 862.8 / 4500, 1e-6), "sem holerite: média do salário dos 3 meses anteriores", semHolerite.peso);
const semNada = resumo(v, brutos(), HOJE);
ok(semNada.peso === null && perto(semNada.parcelasDoMes, 862.8), "sem holerite e sem salário: peso nulo", semNada);
const vazio = resumo([], brutos(), HOJE);
ok(vazio.deve === 0 && vazio.juros === 0 && vazio.livre === null && vazio.semData === 0 && vazio.parcelasDoMes === 0, "resumo vazio", vazio);

// ---------- sugestões de pagamento ----------
const sug = sugestoesPagamento(brutos(), HOJE);
ok(sug.length === 1, "uma sugestão só", sug.map((s) => `${s.lancamento.id}/${s.divida.id}`));
ok(sug[0]?.lancamento.id === "s1" && sug[0].divida.id === "d_emp" && sug[0].n === 4 && sug[0].t === 12, "acha a parcela 4 de 12 a 3 dias do vencimento", sug[0]);
const semRecusa = sugestoesPagamento(brutos({ dividasRecusados: [] }), HOJE);
ok(semRecusa.map((s) => s.lancamento.id).sort().join(",") === "s1,s4", "sem a recusa, s4 também aparece", semRecusa.map((s) => s.lancamento.id));
// Vencimento anterior (outubro) também vale; e a dívida sem total devolve t nulo.
const anterior = sugestoesPagamento(brutos({ movimentacoes: [mov("q", "2026-10-15", "CREDIARIO", -200, { natureza: "pagamento_divida" })] }), HOJE);
ok(anterior.length === 1 && anterior[0].divida.id === "d_loja" && anterior[0].n === null && anterior[0].t === null, "vencimento anterior, pagamento_divida, sem total", anterior);
// Tolerância de R$ 1,00 quando 2% é menos que isso.
const pequena = brutos({ dividas: [div("pq", { parcela_valor: 30, parcelas_restantes: 3, parcelas_total: 3, proximo_vencimento: "2026-11-20" })], emprestimos: [], movimentacoes: [mov("a", "2026-11-20", "X", -30.9), mov("b", "2026-11-20", "Y", -31.2)] });
ok(sugestoesPagamento(pequena, HOJE).map((s) => s.lancamento.id).join(",") === "a", "parcela pequena: até R$ 1,00 de diferença");
ok(sugestoesPagamento(brutos({ dividas: [dividas[2]] }), HOJE).length === 0, "dívida sem parcela não recebe sugestão");
// Duas dívidas com parcela parecida: o lançamento vira uma sugestão só, a de valor mais próximo.
const parecidas = brutos({
  dividas: [
    div("da", { parcela_valor: 100, parcelas_restantes: 3, proximo_vencimento: "2026-11-20" }),
    div("db", { parcela_valor: 101, parcelas_restantes: 3, proximo_vencimento: "2026-11-20" }),
  ],
  emprestimos: [],
  movimentacoes: [mov("l", "2026-11-20", "PAGAMENTO", -100.9)],
});
const umaSo = sugestoesPagamento(parecidas, HOJE);
ok(umaSo.length === 1 && umaSo[0].divida.id === "db", "um lançamento, uma sugestão: valor mais próximo", umaSo.map((s) => s.divida.id));
// Mesmo valor: fica a do vencimento mais perto.
const mesmoValor = brutos({
  dividas: [
    div("dc", { parcela_valor: 100, parcelas_restantes: 3, proximo_vencimento: "2026-11-28" }),
    div("dd", { parcela_valor: 100, parcelas_restantes: 3, proximo_vencimento: "2026-11-21" }),
  ],
  emprestimos: [],
  movimentacoes: [mov("l", "2026-11-20", "PAGAMENTO", -100)],
});
const perto2 = sugestoesPagamento(mesmoValor, HOJE);
ok(perto2.length === 1 && perto2[0].divida.id === "dd", "mesmo valor: vencimento mais perto", perto2.map((s) => s.divida.id));
// Só depois do último saldo informado (o que veio antes já está descontado dele); o saldo
// estimado de um lançamento não conta; sem saldo, depois de quando a dívida foi cadastrada.
const comBase = (extra: Partial<Divida>) =>
  brutos({
    dividas: [div("b", { parcela_valor: 100, parcelas_restantes: 3, proximo_vencimento: "2026-11-20", ...extra })],
    emprestimos: [],
    movimentacoes: [mov("igual", "2026-11-15", "PARCELA", -100), mov("depois", "2026-11-16", "PARCELA", -100), mov("antes", "2026-11-12", "PARCELA", -100)],
  });
const informado15 = { saldos: [{ data: "2026-11-15", saldo_devedor: 300, origem: { tipo: "informado" } }, { data: "2026-11-18", saldo_devedor: 200, origem: { tipo: "lancamento", id: "x" } }] };
ok(sugestoesPagamento(comBase(informado15), HOJE).map((s) => s.lancamento.id).join(",") === "depois", "só lançamentos depois do saldo informado", sugestoesPagamento(comBase(informado15), HOJE).map((s) => s.lancamento.id));
ok(sugestoesPagamento(comBase({ saldos: [], informado_em: "2026-11-15T10:00:00-03:00" }), HOJE).map((s) => s.lancamento.id).join(",") === "depois", "sem saldo: depois do cadastro");
ok(sugestoesPagamento(comBase({ saldos: [] }), HOJE).length === 3, "sem saldo nem data de cadastro: todos");
const dBase = div("b", informado15);
ok(ultimoSaldoInformado(dBase)?.data === "2026-11-15" && ultimoSaldoInformado(div("z", {})) === null, "último saldo informado ignora o do lançamento");
ok(!depoisDoSaldoInformado(dBase, "2026-11-15") && depoisDoSaldoInformado(dBase, "2026-11-16") && depoisDoSaldoInformado(div("z", {}), "2000-01-01"), "depois do saldo informado");

// ---------- simulador ----------
const s500 = simularAdiantar(v, 500)!;
ok(s500.alvo?.id === "d_emp" && !s500.quita && s500.sobra === 0 && s500.proxima === null, "adiantar 500 vai para a de maior taxa", s500);
ok(perto(s500.economia, 338.78, 0.05) && s500.mesesAMenos === 2, "adiantar 500 economiza ≈ 338,78 e tira 2 meses", s500);
const s3000 = simularAdiantar(v, 3000)!;
ok(s3000.quita && perto(s3000.sobra, 228.56) && perto(s3000.economia, 943.76) && s3000.mesesAMenos === 9, "adiantar além do saldo quita e sobra", s3000);
ok(s3000.proxima?.id === "d_ipva", "a sobra vai para a próxima da ordem", s3000.proxima?.id);
ok(simularAdiantar(v, 0) === null, "adiantar 0: nada a simular");
const semTaxa = simularAdiantar(v.filter((x) => x.id !== "d_emp"), 500)!;
ok(semTaxa !== null && semTaxa.alvo === null && semTaxa.economia === 0 && semTaxa.mesesAMenos === 0, "sem dívida com juros: sem alvo", semTaxa);

// ---------- ordem ----------
const ordem = ordemSugerida(v);
ok(ordem.map((o) => o.divida.id).join(",") === ["d_emp", "d_ipva", "d_loja", cartao.id, pessoa.id, "d_sem", "d_apagado"].join(","), "ordem: juros, atraso, sem juros, desconhecidos", ordem.map((o) => o.divida.id));
ok(ordem[0].motivo === "6,3% ao mês é o juro mais caro", "motivo do juro mais caro", ordem[0].motivo);
ok(ordem[1].motivo === "em atraso, a multa cresce", "motivo do atraso", ordem[1].motivo);
ok(ordem[3].motivo === "sem juros, siga as parcelas", "motivo do cartão", ordem[3].motivo);
ok(ordem[4].motivo === "sem juros, combine com a pessoa", "motivo da pessoa", ordem[4].motivo);
ok(ordem[5].motivo === "sem juros, siga as parcelas", "motivo sem juros", ordem[5].motivo);
ok(ordem[6].motivo === "juros desconhecidos", "motivo desconhecido", ordem[6].motivo);
const duas = ordemSugerida([{ ...emp, id: "a", taxa: 0.02 }, { ...emp, id: "b", taxa: 0.05 }]);
ok(duas.map((o) => o.divida.id).join(",") === "b,a" && duas[0].motivo === "5% ao mês é o juro mais caro" && duas[1].motivo === "2% ao mês", "maior taxa primeiro", duas);

if (falhas) {
  console.error(`${falhas} teste(s) falharam`);
  process.exit(1);
}
