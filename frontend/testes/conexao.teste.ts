import type { EstadoSync, ExecucaoSync } from "../src/api";
import { dadosDoBanco, mensagemDepoisDeAtualizar, problemaNaConexao, textoAtualizado } from "../src/conexao";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// 19/11/2026 15:00 em Brasília.
const agora = new Date("2026-11-19T18:00:00Z");
const exec = (em: string, extra: Partial<ExecucaoSync> = {}): ExecucaoSync => ({ em, ok: true, ...extra });
const estado = (ultimaOk: ExecucaoSync | null, ultima: ExecucaoSync | null = ultimaOk): EstadoSync => ({ configurada: true, ultima, ultima_ok: ultimaOk });
const nada = { nivel: null, texto: "" };

ok(igual(problemaNaConexao(null, agora), nada), "sem estado");
ok(igual(problemaNaConexao({ configurada: false, ultima: null, ultima_ok: null }, agora), nada), "não configurada");
ok(igual(problemaNaConexao(estado(exec("2026-11-19T12:00:00Z")), agora), nada), "tudo em dia");
ok(
  igual(problemaNaConexao(estado(exec("2026-11-19T12:00:00Z"), { em: "2026-11-19T17:00:00Z", ok: false }), agora), { nivel: "erro", texto: "Problema na conexão com o banco" }),
  "última sincronização falhou",
);
ok(
  problemaNaConexao(estado(exec("2026-11-19T12:00:00Z", { conexoes: [{ status: "LOGIN_ERROR" }] })), agora).nivel === "erro",
  "conexão precisando renovar",
);
ok(problemaNaConexao(estado(exec("2026-11-19T12:00:00Z", { conexao: { erro: "x" } })), agora).nivel === "erro", "conexão antiga com erro");
ok(igual(problemaNaConexao(estado(exec("2026-11-16T12:00:00Z")), agora), { nivel: "atencao", texto: "Banco sem atualizar há 3 dias" }), "banco parado há 3 dias");
ok(igual(problemaNaConexao(estado(exec("2026-11-17T20:00:00Z")), agora), nada), "menos de 2 dias não avisa");
ok(
  igual(problemaNaConexao(estado(exec("2026-11-19T12:00:00Z", { conexoes: [{ status: "UPDATED", consentimento_ate: "2026-12-09T18:00:00Z" }] })), agora), {
    nivel: "atencao",
    texto: "Autorização do banco vence em 20 dias",
  }),
  "consentimento em 20 dias",
);
ok(
  problemaNaConexao(estado(exec("2026-11-19T12:00:00Z", { conexoes: [{ status: "UPDATED", consentimento_ate: "2026-11-20T19:00:00Z" }] })), agora).texto ===
    "Autorização do banco vence em 1 dia",
  "consentimento em 1 dia (singular)",
);
ok(
  igual(problemaNaConexao(estado(exec("2026-11-19T12:00:00Z", { conexoes: [{ status: "UPDATED", consentimento_ate: "2027-01-30T00:00:00Z" }] })), agora), nada),
  "consentimento longe",
);
ok(
  problemaNaConexao(estado(exec("2026-11-10T12:00:00Z", { conexoes: [{ status: "LOGIN_ERROR", consentimento_ate: "2026-11-25T00:00:00Z" }] })), agora).nivel === "erro",
  "erro vence a atenção",
);

const carregado = new Date("2026-11-19T17:30:00Z");
// Sem a hora da leitura do banco (conexões antigas): vale a sincronização.
ok(textoAtualizado(true, estado(exec("2026-11-19T16:05:00Z")), carregado, agora) === "Atualizado às 13:05", "com banco, hoje: hora da sincronização");
ok(textoAtualizado(true, estado(exec("2026-11-17T12:40:00Z")), carregado, agora) === "Banco atualizado 17/11 às 09:40", "com banco, outro dia");
ok(textoAtualizado(true, estado(null), carregado, agora) === "Atualizado às 14:30", "com banco sem sincronização boa: hora da carga");
ok(textoAtualizado(false, estado(exec("2026-11-17T12:40:00Z")), carregado, agora) === "Atualizado às 14:30", "sem banco: hora da carga");
ok(textoAtualizado(false, null, null, agora) === null, "nada carregado ainda");

// Com a hora da leitura do banco: é ela que mostra a idade real do saldo (a conexão mais antiga).
const duas = (lida1: string, lida2: string, prox1: string, prox2: string) =>
  estado(
    exec("2026-11-19T18:38:00Z", {
      conexoes: [
        { status: "UPDATED", atualizada_na_pluggy_em: lida1, proxima_atualizacao_automatica: prox1 },
        { status: "UPDATED", atualizada_na_pluggy_em: lida2, proxima_atualizacao_automatica: prox2 },
      ],
    }),
  );
const ontem = duas("2026-11-18T18:50:34Z", "2026-11-18T19:13:41Z", "2026-11-19T18:50:34Z", "2026-11-19T19:13:41Z");
const d = dadosDoBanco(ontem);
ok(d?.em.toISOString() === "2026-11-18T18:50:34.000Z" && d?.proxima?.toISOString() === "2026-11-19T18:50:34.000Z", "a mais antiga e a próxima mais cedo", d);
ok(textoAtualizado(true, ontem, carregado, agora) === "Dados do banco de ontem às 15:50", "dados de ontem", textoAtualizado(true, ontem, carregado, agora));
const hoje = duas("2026-11-19T12:10:00Z", "2026-11-19T13:00:00Z", "2026-11-20T12:10:00Z", "2026-11-20T13:00:00Z");
ok(textoAtualizado(true, hoje, carregado, agora) === "Dados do banco de hoje às 09:10", "dados de hoje");
const velho = duas("2026-11-16T12:00:00Z", "2026-11-19T12:00:00Z", "2026-11-17T12:00:00Z", "2026-11-20T12:00:00Z");
ok(textoAtualizado(true, velho, carregado, agora) === "Dados do banco de 16/11 às 09:00", "dados de outro dia");
ok(dadosDoBanco(estado(exec("2026-11-19T12:00:00Z"))) === null, "sem conexões: sem dados do banco");

// Aviso quando a renovação diária atrasou (mais de 30 h).
ok(igual(problemaNaConexao(ontem, agora), nada), "23 h: sem aviso");
ok(
  igual(problemaNaConexao(velho, agora), { nivel: "atencao", texto: "Dados do banco de 16/11 às 09:00" }),
  "mais de 30 h: atenção com a data",
  problemaNaConexao(velho, agora),
);

// Mensagem depois de Atualizar.
ok(
  mensagemDepoisDeAtualizar(ontem, agora) ===
    "Dados do banco de ontem às 15:50. O Open Finance renova os dados uma vez por dia; próxima renovação prevista hoje às 15:50.",
  "renovação ainda por vir",
  mensagemDepoisDeAtualizar(ontem, agora),
);
const depois = new Date("2026-11-19T19:00:00Z"); // 16:00, a renovação das 15:50 já devia ter chegado
ok(
  mensagemDepoisDeAtualizar(ontem, depois) === "Dados do banco de ontem às 15:50. A renovação prevista hoje às 15:50 ainda não chegou; tente de novo em alguns minutos.",
  "renovação atrasada",
  mensagemDepoisDeAtualizar(ontem, depois),
);
ok(mensagemDepoisDeAtualizar(estado(exec("2026-11-19T12:00:00Z")), agora) === null, "sem conexões: sem mensagem");

if (falhas) {
  console.error(`${falhas} falha(s)`);
  process.exit(1);
}
console.log("todos passaram");
