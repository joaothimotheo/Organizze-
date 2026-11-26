# Mês do topo em Dívidas e Contas fixas — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dívidas mostra a projeção de um mês futuro escolhido no topo; Contas fixas segue o mês escolhido.

**Architecture:** Função pura `projetar` em `frontend/src/dividas.ts` sobre as `DividaVista` que `juntarDividas` já monta; `App.tsx` passa `ano`/`mes` do topo para `Dividas` e `Fixas`; as telas escolhem entre o modo normal (hoje) e o modo projeção.

**Tech Stack:** React 18 + TypeScript; testes `cd frontend && npm run teste` (esbuild + node, `frontend/testes/*.teste.ts`); `npm run build`.

**Spec:** `docs/superpowers/specs/2026-11-21-mes-do-topo-dividas-design.md`

## Global Constraints

- Nada muda no servidor nem nos dados gravados.
- Texto da faixa: "Projeção: supõe parcelas pagas em dia."
- Mês passado em Dívidas: tela de hoje + aviso "Para ver o futuro, escolha um mês à frente."
- Modo projeção é só leitura (sem cadastrar/editar/pagar/sugestões).
- "Ano inteiro" (`mes` nulo): Dívidas usa dezembro do ano se for futuro; Contas fixas usa o mês atual.
- Português do Brasil; valores R$ 1.234,56; meses "março/2027".

## Review Focus

1. **Parcela atrasada** (`proxima.data` antes de hoje): conta como paga no mês dela; não some nem duplica. → teste Task 1.
2. **Mês escolhido = mês da última parcela**: a dívida ainda aparece com a parcela do mês e saldo 0? Não — `faltam = 0` → vai para "Quitadas até lá" com `quitadaEm = fim`, e a parcela do mês entra no total de parcelas do mês. → teste Task 1.
3. **Compra do cartão com `proxima.data` "AAAA-MM"** e dívida cadastrada com "AAAA-MM-DD": as duas contam pelo mês. → teste Task 1.
4. **Dezembro → janeiro** (virada de ano na contagem de meses). → teste Task 1.
5. **Mês atual escolhido**: `projetar` não é usada; tela idêntica à de hoje. → verificação manual Task 2.

---

### Task 1: Função de projeção

**Files:**
- Modify: `frontend/src/dividas.ts`
- Test: `frontend/testes/projecao.teste.ts`

**Interfaces:**
- Consumes: `DividaVista`, `juntarDividas`, `resumo`'s `salarioMedio` (exportar se for preciso), `valorPresente`, `addMes` (formato.ts).
- Produces:
  - `export interface ItemProjecao { divida: DividaVista; saldo: number; parcelaDoMes: number; faltam: number | null /* null = sem data */ }`
  - `export interface Projecao { mes: string; deve: number; deveHoje: number; parcelasDoMes: number; peso: number | null; itens: ItemProjecao[]; quitadas: { divida: DividaVista; quitadaEm: string /* AAAA-MM */ }[] }`
  - `export function projetar(b: Brutos, mes: string, hoje: string): Projecao`
  - `export function mesDaProjecao(ano: number, mes: number | null, hoje: string): string | null` — `null` quando o mês (ou, com `mes` nulo, dezembro do ano) não é futuro.

Regras (do spec): para cada `DividaVista` de `juntarDividas(b, hoje)`:
- Sem `parcela` → item com `saldo = ateOFim`, `parcelaDoMes = 0`, `faltam = null`.
- Com `parcela`: `inicio = proxima.data.slice(0,7)` (sem `proxima`: mês de hoje); `k = M < inicio ? 0 : min(restantes, meses(inicio..M inclusive))`; `faltam = restantes − k`; `parcelaDoMes = parcela` se `inicio ≤ M ≤ fim`, senão 0. `faltam == 0` → vai para `quitadas` com `quitadaEm = fim` (e a `parcelaDoMes` ainda soma em `parcelasDoMes` se `fim == M`). Senão `saldo = taxa > 0 ? valorPresente(parcela, taxa, faltam) : parcela × faltam`.
- `deve` = soma dos `saldo` dos itens; `deveHoje` = soma dos `ateOFim` de hoje (o mesmo "deve" do `resumo`); `parcelasDoMes` = soma das `parcelaDoMes`; `peso = parcelasDoMes / salarioMedio(b, hoje)` (null sem salário).
- Itens ordenados como a lista de hoje (`juntarDividas`).

- [ ] **Step 1: Testes** em `projecao.teste.ts` (estilo dos outros `*.teste.ts`), com `hoje = "2026-11-21"`:
  - `com juros`: parcela 412,80, taxa 0,063, restantes 9, próxima 2026-12-10 → em 2027-03: k = 4, faltam 5, saldo = valorPresente(412.8, 0.063, 5) (comparar com 2 casas), parcelaDoMes 412,80.
  - `sem juros`: parcela 100, taxa 0, restantes 6, próxima 2026-12 → 2027-02: faltam 3, saldo 300.
  - `quitada antes`: restantes 2, próxima 2026-12 → 2027-03: vai para `quitadas` com `quitadaEm` "2027-01", fora de `itens`.
  - `última parcela no mês`: restantes 4, próxima 2026-12 (fim 2027-03) → 2027-03: em `quitadas` ("2027-03") e `parcelasDoMes` inclui a parcela.
  - `atrasada`: próxima 2026-10-05 (antes de hoje), restantes 5 → 2027-01: k = 4 (out, nov, dez, jan), faltam 1.
  - `cartão por mês`: `proxima.data` "2026-12" com fim "2027-02" → 2027-01: parcelaDoMes = parcela, faltam 1.
  - `sem data`: dívida de pessoa (parcela null) → item com saldo = ateOFim, faltam null.
  - `mesDaProjecao`: (2027, 3, hoje) → "2027-03"; (2026, 11, hoje) → null; (2026, 5, hoje) → null; (2027, null, hoje) → "2027-12"; (2026, null, hoje) → null.
  - Monte os `Brutos` mínimos que `juntarDividas` aceita (veja `frontend/testes/dividas.teste.ts` para fábricas de dívida/cartão/pessoa já usadas).
- [ ] **Step 2: Rodar** `cd frontend && npm run teste` → FAIL (função não existe).
- [ ] **Step 3: Implementar** `projetar` e `mesDaProjecao` em `dividas.ts`.
- [ ] **Step 4: Rodar** `npm run teste` → PASS.
- [ ] **Step 5: Commit** `feat(dividas): projeção de um mês futuro`.

### Task 2: Telas seguem o mês do topo

**Files:**
- Modify: `frontend/src/App.tsx:413,418` (passar `ano={anoVisto} mes={mesVisto}` para `Dividas` e `Fixas`)
- Modify: `frontend/src/paginas/Dividas.tsx`
- Modify: `frontend/src/paginas/Fixas.tsx`

**Interfaces:**
- Consumes: `projetar`, `mesDaProjecao`, `Projecao`, `ItemProjecao` (Task 1).
- Produces: `Dividas({ brutos, aoMudar, ano, mes })`, `Fixas({ brutos, aoMudar, ano, mes })`.

- [ ] **Step 1: Dívidas.** `const alvo = mesDaProjecao(ano, mes, hoje)`. Com `alvo`: renderiza só o modo projeção (faixa "Projeção: supõe parcelas pagas em dia.", topo "Você ainda vai dever R$ X (hoje: R$ Y)", "Parcelas de <mês> R$ Z · N% do salário" (sem salário: sem a porcentagem), "Quitadas até lá: Nome (fev/2027), …" (omitir a linha se vazio), tabela/lista Dívida · Saldo em <mês> · Parcela de <mês> (0 → "—") · Faltam (número ou "sem data")), reaproveitando os componentes/estilos da tela, sem botões de cadastrar/editar/pagar, sem sugestões nem simulador. Sem `alvo` e mês escolhido < mês de hoje: tela normal + aviso "Para ver o futuro, escolha um mês à frente." Mês atual: tela normal, sem aviso. Valores passam por `reais()` (respeita "esconder valores").
- [ ] **Step 2: Contas fixas.** `mesVisto` = `AAAA-MM` do topo (com `mes` nulo: mês atual). Lista/resumo usam esse mês em `situacao`/`resumo`; `diaHoje` = dia de hoje se for o mês atual, 32 se passado (para "atrasada"), 0 se futuro (tudo "a vencer"). Título/rotulo mostra o mês quando não for o atual ("Contas fixas de março/2027"). Sugestões de novas fixas, cadastro e "Cancelei" continuam iguais (hoje).
- [ ] **Step 3: Rodar** `npm run teste` e `npm run build` → PASS. Conferir no navegador local (`~/.cargo/bin/cargo build --manifest-path backend/Cargo.toml` e o servidor com `FINANCEIRO_ENV=/dev/null`, dados num cópia de `dados-exemplo` com 1 dívida cadastrada parcelada e 1 conta fixa): mês atual igual a antes; mês futuro mostra a projeção; mês passado mostra o aviso; Contas fixas muda com o mês.
- [ ] **Step 4: Commit** `feat: Dívidas e Contas fixas seguem o mês do topo`.
