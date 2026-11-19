# Dinheiro extra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quadro "Vou receber um dinheiro" na aba Objetivos que separa o que já tem destino e sugere onde usar o resto.

**Architecture:** Lógica pura em `frontend/src/extra.ts` (sem React), testada por um script Node; componente `DinheiroExtra.tsx` só lê os brutos, chama a lógica e desenha. Nada novo no servidor; o que você digita fica no `localStorage` (`tf-extra`).

**Tech Stack:** React 18 + TypeScript 5.5, esbuild (via Vite) para rodar o teste em Node.

**Spec:** `docs/superpowers/specs/2026-11-16-dinheiro-extra-design.md`

## Global Constraints
- Corte "dívida cara": taxa ≥ 1% ao mês.
- Ordem do resto: atrasadas → com juros (maior taxa primeiro) → reserva até a meta → juros desconhecidos → sem juros → sobra na reserva.
- Antecipação: parcelas inteiras, da última para a primeira; custo de cada uma = parcela ÷ (1 + taxa)^meses até o vencimento (mínimo 1 mês).
- `taxa_mensal` cadastrada está em porcentagem (2,5 = 2,5% a.m.).
- Fatura do cartão (`tipo: cartao_de_credito`) nunca entra.
- Textos em português, valores em R$ com vírgula.

## Review Focus
- Separações somando mais que o valor recebido: nada sugerido, aviso "as separações passam do valor em R$ X".
- Valor vazio ou zero: quadro mostra só o formulário, sem sugestão.
- Dívida parcelada sem `proximo_vencimento`: primeira parcela no mês seguinte ao recebimento.
- Taxa implícita quando parcelas × valor ≤ valor original (sem juros): 0%.
- Dinheiro menor que uma parcela da dívida cara: passa para o próximo passo, sem antecipação parcial.

---

### Task 1: Lógica `extra.ts`

**Files:**
- Create: `frontend/src/extra.ts`
- Test: `frontend/testes/extra.teste.ts` (rodar: `npx esbuild testes/extra.teste.ts --bundle --platform=node --outfile=<scratch>/t.js && node <scratch>/t.js`)

**Interfaces:**
- Produces:
  - `taxaImplicita(valorOriginal: number, parcelas: number, parcela: number): number` (fração ao mês; 0 sem juros)
  - `interface Candidata { id: string; nome: string; tipo: "atrasada" | "juros" | "sem_juros" | "desconhecida"; taxa: number | null; parcela: number; restantes: number; primeiroMes: string; saldo: number }`
  - `candidatas(brutos: Brutos, mesRecebe: string): Candidata[]`
  - `interface Passo { tipo: "separado" | "atrasada" | "juros" | "reserva" | "desconhecida" | "sem_juros" | "sobra"; nome: string; valor: number; parcelas?: number; economia?: number; quita?: boolean; terminaEm?: string | null; terminavaEm?: string | null; aviso?: string }`
  - `planejar(e: { valor: number; mes: string; separacoes: { nome: string; valor: number }[]; candidatas: Candidata[]; faltaReserva: number }): { passos: Passo[]; excedeu: number; economia: number }`

- [ ] Teste: `taxaImplicita(3994.55, 18, 376.65)` entre 0,059 e 0,066; `taxaImplicita(3876, 19, 204) === 0`.
- [ ] Teste: separações 1900 + 800 de 5000 → primeiros passos "separado" com esses valores; separações 6000 de 5000 → `excedeu === 1000` e nenhum passo além dos separados.
- [ ] Teste: atrasada de 1851,84 e dívida a 6% com 18 × 376,65 a partir de 2026-12, mês 2026-12, resto 2300 → passo atrasada 1851,84; depois `juros` com `parcelas === 2`, `economia > 0`, custo ≤ 448,16 e `terminaEm` dois meses antes de `terminavaEm`; o que não fecha uma parcela vai para reserva.
- [ ] Teste: resto 100 com dívida a 6% de parcela 376,65 → nenhum passo `juros`, 100 vai para `reserva`.
- [ ] Implementar e rodar até passar.

### Task 2: Quadro `DinheiroExtra.tsx` em Objetivos

**Files:**
- Create: `frontend/src/componentes/DinheiroExtra.tsx`
- Modify: `frontend/src/paginas/Objetivos.tsx` (entre `QuadroReserva` e o simulador), `frontend/src/estilo.css`

**Interfaces:**
- Consumes: `candidatas`, `planejar`, `Passo` (Task 1); `saldoReserva`/`guardadoNaMeta` de `plano.ts`.
- Produces: `DinheiroExtra({ brutos, saldoReserva }: { brutos: Brutos; saldoReserva: number | null })`.

- [ ] Campos: valor (R$), mês (`<input type="month">`, padrão mês seguinte), lista "Já tem destino" com nome + valor + remover, botão "Adicionar destino". Guardar em `localStorage` `tf-extra` com try/catch.
- [ ] Lista de passos em ordem, cada um com valor e explicação; resumo com separado, sugerido, economia de juros. Aviso fixo: "O desconto exato da antecipação quem informa é o banco."
- [ ] `npx tsc -b`, build, conferir no navegador (celular e computador) com dados de teste; página sem rolagem lateral.
- [ ] Commit junto com as contas fixas em linhas.
