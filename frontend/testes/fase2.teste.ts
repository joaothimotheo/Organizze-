import { nomeNatureza, soNatureza } from "../src/grupos";
import { rotuloFora } from "../src/formato";
import { categoriaDaFixa } from "../src/fixas";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}

// Depois de migrar, o que não conta no mês mostra só a natureza (sem lista de grupos).
ok(soNatureza(true, "aporte_investimento") === true, "aporte migrado: só a natureza");
ok(soNatureza(true, "transferencia_interna") === true, "transferência migrada: só a natureza");
ok(soNatureza(true, "despesa") === false && soNatureza(true, "estorno") === false, "gasto e entrada têm lista");
ok(soNatureza(false, "aporte_investimento") === false, "sem migrar, como antes");
ok(soNatureza(true, null) === false && soNatureza(true, undefined) === false, "sem natureza, sem filtro");
ok(nomeNatureza("pagamento_divida") === "Paguei uma dívida", "nome da natureza");
ok(nomeNatureza("resgate_investimento") === "Tirei da reserva", "nome da natureza de entrada");
ok(nomeNatureza("transferencia_interna") === "Entre minhas contas", "transferência");

// Valor atual fora das opções: opção desabilitada com "Escolha…" ou o nome.
const opcoes: [string, string][] = [["outros", "Outros gastos"], ["p_carro", "Carro"]];
ok(rotuloFora("outros", opcoes) === null, "valor na lista: nada");
ok(rotuloFora("a_classificar", opcoes) === "Escolha…", "a classificar: Escolha…");
ok(rotuloFora("", opcoes) === "Escolha…", "vazio: Escolha…");
ok(rotuloFora("salario", opcoes) === "Salário", "outro tipo: o nome dele");

// Conta fixa: o padrão mostrado é o gravado.
ok(categoriaDaFixa("", true) === "outros", "migrado: Outros gastos");
ok(categoriaDaFixa("", false) === "assinaturas", "sem migrar: Assinaturas");
ok(categoriaDaFixa(null, true) === "outros", "nula: padrão");
ok(categoriaDaFixa("p_casa", true) === "p_casa", "escolhida fica");

if (falhas) process.exit(1);
console.log("todos passaram");
