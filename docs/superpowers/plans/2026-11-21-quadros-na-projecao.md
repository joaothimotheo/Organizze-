# Quadros da tela de hoje na projeção de Dívidas — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na projeção de um mês futuro, Dívidas mostra também os quadros por tipo, "Parcelas já comprometidas" e "Quando fico livre das dívidas", a partir do mês escolhido.

**Architecture:** `projetar` passa a devolver, para cada item, uma `DividaVista` projetada (mesmo formato da de hoje), e a tela de projeção reaproveita os componentes da tela de hoje (blocos por tipo com `LinhaDivida` em modo só leitura, `GraficoParcelas`, `PlanoQuitacao` com início configurável).

**Tech Stack:** React 18 + TS; `cd frontend && npm run teste`; `npm run build`.

**Spec:** `docs/superpowers/specs/2026-11-21-mes-do-topo-dividas-design.md` (seção "Adendo")

## Global Constraints

- Só leitura na projeção: nada de editar, excluir, ligar pagamento, sugestões; nenhuma chamada de escrita à API.
- Faixa "Projeção: supõe parcelas pagas em dia." continua no topo.
- Saldo projetado nominal (parcela × faltam), como já está em `projetar`.
- Mês atual e meses passados: tela idêntica à de agora.
- Português do Brasil; valores via `reais()`.

## Review Focus

1. **Dívida que termina exatamente no mês escolhido**: não aparece nos blocos (está em "Quitadas até lá"), e o total do bloco não a soma. → teste Task 1.
2. **"Próxima" na projeção** = parcela do mês escolhido (se cair nele) senão a primeira depois; nunca uma data antes do mês escolhido ("Venceu" não pode aparecer na projeção). → teste Task 1.
3. **Compra do cartão com `pagas`/`total` nulos** (sem total conhecido): a linha usa "N parcelas de R$ X faltando" com N = faltam. → teste Task 1.
4. **Gráfico sem nenhuma fatura do mês em diante**: o quadro mostra o estado vazio, não quebra. → verificação Task 2.
5. **Quando fico livre** com o mês escolhido depois da última parcela: só sobram dívidas sem parcela/meta; sem erro. → verificação Task 2.

---

### Task 1: Dívida projetada no formato da tela de hoje

**Files:**
- Modify: `frontend/src/dividas.ts` (`ItemProjecao`, `projetar`)
- Test: `frontend/testes/projecao.teste.ts`

**Interfaces:**
- Produces: `ItemProjecao` ganha `vista: DividaVista` — a dívida como estará no fim do mês M: `restantes = faltam ?? restantes de hoje`, `pagas = pagas de hoje + k` (null se era null), `proxima = { valor: parcela, data: <primeiro mês ≥ M com parcela, "AAAA-MM"> }` (null sem parcela ou quitada), `ateOFim = saldo`, `quitarHoje = saldo`, `juros = 0`, `atraso = false`, `etiqueta` como hoje exceto "atraso" → null, `pagamentos` = os de hoje, `fim` igual.

- [ ] **Step 1: Testes** (hoje "2026-11-21"): dívida 9 × 412,80 próxima 2026-12-10, `total` 12, `pagas` 3 → em "2027-03": `vista.pagas === 7`, `vista.restantes === 5`, `vista.proxima.data === "2027-03"`, `vista.ateOFim === 2064`; dívida atrasada (próxima 2026-10-05) em "2027-01": `vista.atraso === false` e `vista.proxima.data >= "2027-01"`; compra do cartão sem `total` → `vista.pagas === null`, `vista.restantes === faltam`; dívida que termina no mês → não está em `itens`.
- [ ] **Step 2: Rodar** `npm run teste` → FAIL.
- [ ] **Step 3: Implementar** em `projetar`.
- [ ] **Step 4: Rodar** `npm run teste` → PASS.
- [ ] **Step 5: Commit** `feat(dividas): dívida projetada no formato da tela de hoje`.

### Task 2: Quadros na tela de projeção

**Files:**
- Modify: `frontend/src/paginas/Dividas.tsx` (`ProjecaoDividas`; `LinhaDivida` ganha `somenteLeitura?: boolean`)
- Modify: `frontend/src/componentes/Plano.tsx` (`PlanoQuitacao` ganha `inicio?: string`, padrão = mês seguinte ao de hoje, como agora)

**Interfaces:**
- Consumes: `projetar(...).itens[].vista` (Task 1).

- [ ] **Step 1: Quadros por tipo.** Em `ProjecaoDividas`, depois do topo atual, os mesmos blocos por tipo da tela de hoje (título do tipo + total do tipo = soma dos `vista.ateOFim`), com `LinhaDivida d={item.vista} hoje={<mês escolhido>-01} somenteLeitura`. Com `somenteLeitura`: sem botões de editar/excluir, sem ligar/desfazer pagamento, sem `NomeParcelamento` editável e sem os avisos de "ligado antes"; o detalhe expandido mostra só o histórico de pagamentos. Mantém a tabela atual? Não: os blocos substituem a tabela (mesma informação, mais completa). "Quitadas até lá" continua.
- [ ] **Step 2: Parcelas já comprometidas.** Mesmo cálculo de `comprometido` da tela de hoje, filtrado para meses ≥ mês escolhido; extrair esse cálculo para uma função pura em `dividas.ts` (`export function parcelasPorFatura(b: Brutos): [string, number][]`) usada pelas duas telas.
- [ ] **Step 3: Quando fico livre.** `PlanoQuitacao` com `inicio={mês escolhido}` e `parceladas` = as da tela de hoje com `meses` filtrados para ≥ mês escolhido (descartando as que ficam sem meses).
- [ ] **Step 4: Rodar** `npm run teste` e `npm run build` → PASS. Conferir no navegador local (servidor com cópia de `dados-exemplo` + 1 empréstimo parcelado + 1 compra parcelada no cartão + 1 dívida de pessoa): mês atual igual a antes; mês futuro com os três quadros; mês depois da última parcela sem erro; nenhum botão de escrita na projeção.
- [ ] **Step 5: Commit** `feat(dividas): quadros por tipo, parcelas comprometidas e plano também na projeção`.
