import { planejar, taxaImplicita, type Candidata } from "../src/extra";

let falhas = 0;
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", nome, extra ?? "");
  } else console.log("ok:", nome);
}

// Taxa implícita
const t = taxaImplicita(3994.55, 18, 376.65);
ok(t > 0.059 && t < 0.066, "empréstimo Santander ~6% a.m.", t);
ok(taxaImplicita(3876, 19, 204) === 0, "Nubank sem juros");

const emprestimo: Candidata = { id: "e", nome: "Empréstimo", tipo: "juros", taxa: t, parcela: 376.65, restantes: 18, primeiroMes: "2026-12", saldo: 6779.7 };
const ipva: Candidata = { id: "i", nome: "IPVA 2025", tipo: "atrasada", taxa: null, parcela: 1851.84, restantes: 1, primeiroMes: "2026-12", saldo: 1851.84 };

// Separações
const a = planejar({ valor: 5000, mes: "2026-12", separacoes: [{ nome: "IPVA 2027", valor: 1900 }, { nome: "Compra", valor: 800 }], candidatas: [], faltaReserva: 0 });
ok(a.passos[0]?.tipo === "separado" && a.passos[0].valor === 1900 && a.passos[1]?.valor === 800, "separações primeiro", a.passos);
const b = planejar({ valor: 5000, mes: "2026-12", separacoes: [{ nome: "Grande", valor: 6000 }], candidatas: [ipva], faltaReserva: 0 });
ok(b.excedeu === 1000 && b.passos.every((p) => p.tipo === "separado"), "separações passam do valor", b);

// Ordem: atrasada, depois juros (parcelas inteiras do fim), resto na reserva
const c = planejar({ valor: 300 + 1851.84, mes: "2026-12", separacoes: [], candidatas: [emprestimo, ipva], faltaReserva: 5000 });
const pj = c.passos.find((p) => p.tipo === "juros");
ok(c.passos[0]?.tipo === "atrasada" && Math.abs(c.passos[0].valor - 1851.84) < 0.01, "atrasada primeiro", c.passos);
ok(pj?.parcelas === 2 && (pj.economia ?? 0) > 0 && pj.valor <= 300, "antecipa 2 parcelas com desconto", pj);
ok(pj?.terminavaEm === "2028-05" && pj?.terminaEm === "2028-03", "termina 2 meses antes", pj);
ok(c.passos.some((p) => p.tipo === "reserva" && p.valor > 0), "resto vai para a reserva", c.passos);
const soma = c.passos.reduce((s, p) => s + p.valor, 0);
ok(Math.abs(soma - (300 + 1851.84)) < 0.02, "soma dos passos = valor recebido", soma);

// Dinheiro menor que uma parcela
const d = planejar({ valor: 100, mes: "2026-12", separacoes: [], candidatas: [emprestimo], faltaReserva: 5000 });
ok(!d.passos.some((p) => p.tipo === "juros") && d.passos.some((p) => p.tipo === "reserva" && p.valor === 100), "menos que uma parcela vai para a reserva", d.passos);

if (falhas) {
  console.error(`${falhas} falha(s)`);
  process.exit(1);
}
console.log("todos passaram");
