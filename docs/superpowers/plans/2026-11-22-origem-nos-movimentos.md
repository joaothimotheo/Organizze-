# Origem de cada lançamento em Movimentos — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada lançamento da lista de Movimentos mostra uma etiqueta colorida com a origem (Crédito, Débito, Mercado Pago, Dinheiro), e o topo tem atalhos para filtrar por origem.

**Architecture:** Função pura `origemDe` em `frontend/src/movimentos.ts` classifica a conta do lançamento; `Movimentos.tsx` desenha a etiqueta na segunda linha e os atalhos acima da lista; cores em tokens novos no `estilo.css`.

**Tech Stack:** React 18 + TS; `cd frontend && npm run teste`; `npm run build`.

**Spec:** `docs/superpowers/specs/2026-11-22-origem-nos-movimentos-design.md`

## Global Constraints

- Rótulos: "Crédito", "Débito", nome da instituição da reserva (ex.: "Mercado Pago"; sem instituição "Reserva"), "Dinheiro". Com mais de um cartão: "Crédito <instituição>"; com mais de uma conta corrente: "Débito <instituição>".
- Texto sempre visível na etiqueta (não só cor); nome completo da conta no `title` e no `aria-label`.
- Cores em tokens com versão clara e escura: crédito violeta, débito `--accent`, reserva azul, dinheiro `--ink-3`; contraste AA.
- Atalhos: "Todos" + só as origens presentes nos lançamentos; somam com o filtro por conta de "Filtros".
- Nada muda no servidor nem nos dados.

## Review Focus

1. **Conta do lançamento que não existe mais em `brutos.contas`** (conta removida): etiqueta neutra com o rótulo "Conta", sem quebrar. → teste Task 1.
2. **Conta sem `tipo`** (cadastro antigo): tratada como débito. → teste Task 1.
3. **Dois cartões de bancos diferentes**: rótulos "Crédito Nubank" e "Crédito Santander"; os atalhos mostram os dois separados. → teste Task 1.
4. **Reserva que também é cartão** não existe; se `papel: "reserva"`, vale reserva acima do tipo. → teste Task 1.
5. **Celular (375 px)**: etiqueta não empurra o valor para fora; atalhos rolam na horizontal. → verificação Task 2.

---

### Task 1: Classificar a origem

**Files:**
- Modify: `frontend/src/movimentos.ts`
- Test: `frontend/testes/movimentos.teste.ts` (acrescentar)

**Interfaces:**
- Produces:
  - `export type TipoOrigem = "credito" | "debito" | "reserva" | "dinheiro" | "outra"`
  - `export interface Origem { tipo: TipoOrigem; chave: string /* para filtrar: tipo, ou tipo:conta_id quando o rótulo leva a instituição */; rotulo: string; completo: string /* nome completo da conta, para title/aria */ }`
  - `export function origemDe(contaId: string | null | undefined, contas: ContaCadastrada[], nomeCompleto: (c: ContaCadastrada) => string): Origem`

Regras: `contaId` vazio ou "dinheiro" → dinheiro "Dinheiro"; conta não achada → outra "Conta"; `papel === "reserva"` → reserva, rótulo `instituicao ?? "Reserva"`; `tipo === "cartao"` → crédito; senão → débito. Sufixo de instituição só quando há mais de uma conta não-reserva do mesmo tipo em `contas`. `completo = nomeCompleto(conta)` (para dinheiro: "Dinheiro").

- [ ] **Step 1: Testes** `origemDe`: dinheiro (undefined e "dinheiro"); conta removida → `{tipo:"outra", rotulo:"Conta"}`; reserva Mercado Pago (`tipo:"corrente", papel:"reserva", instituicao:"Mercado Pago"`) → rotulo "Mercado Pago"; reserva sem instituição → "Reserva"; um cartão → "Crédito"; dois cartões (Nubank, Santander) → "Crédito Nubank"/"Crédito Santander" com `chave` diferentes; conta sem `tipo` → débito "Débito"; uma corrente + a reserva → "Débito" (a reserva não conta para o sufixo).
- [ ] **Step 2: Rodar** `npm run teste` → FAIL.
- [ ] **Step 3: Implementar** `origemDe` e os tipos.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(movimentos): origem de cada lançamento (crédito, débito, reserva, dinheiro)`.

### Task 2: Etiqueta e atalhos na lista

**Files:**
- Modify: `frontend/src/paginas/Movimentos.tsx` (`linha`, ~194; estado de filtro; área acima da lista)
- Modify: `frontend/src/estilo.css` (tokens claro/escuro e classes da etiqueta e dos atalhos)

**Interfaces:**
- Consumes: `origemDe`, `Origem` (Task 1); `nomeConta` (de `./Enviar`) como `nomeCompleto`.

- [ ] **Step 1: Etiqueta.** Em `linha(m)`, a segunda linha começa com a pílula da origem (`<span class="mv-origem mv-origem--<tipo>" title=… aria-label="Conta: <completo>">{rotulo}</span>`) e o texto da conta sai do `sub` (fica descrição · parcela).
- [ ] **Step 2: Atalhos.** Acima da lista (abaixo da busca/Filtros), grupo `role="group" aria-label="Origem"` com "Todos" + uma opção por `chave` presente nos lançamentos do período (ordem: crédito, débito, reserva, dinheiro, outra), `aria-pressed`; estado `origem: string | null`; filtra por `origemDe(...).chave === origem` junto com os demais filtros; contadores/totais existentes da lista respeitam o filtro como já fazem com o filtro de conta. Rolagem horizontal no celular.
- [ ] **Step 3: CSS.** Tokens `--orig-credito`, `--orig-debito`, `--orig-reserva`, `--orig-dinheiro` (claro e escuro, nos dois blocos de tema já existentes), fundo com `color-mix` ~12% e texto no tom forte; pílula com `font-size` pequeno, `white-space:nowrap`.
- [ ] **Step 4: Rodar** `npm run teste` e `npm run build` → PASS. Conferir no navegador local (cópia de `dados-exemplo` com contas cartão, corrente e reserva "Mercado Pago" + alguns lançamentos em cada) no desktop e em 375 px, tema claro e escuro.
- [ ] **Step 5: Commit** `feat(movimentos): etiqueta de origem e atalhos por origem na lista`.
