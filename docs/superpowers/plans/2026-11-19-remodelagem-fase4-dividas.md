# Remodelagem Fase 4 – Dívidas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela de Dívidas por tipo (padrões + criados pelo usuário), com o que você deve, juros que faltam, peso das parcelas no mês, quando fica livre, confirmação de pagamentos achados no banco, histórico de cada dívida, simulador de adiantamento e ordem sugerida.

**Architecture:** No servidor, `backend/src/dividas.rs` (novo) guarda os tipos criados e as sugestões recusadas em `dividas.json`, e o vínculo de lançamento com dívida (fase 3, que só guardava) passa a ter efeito: baixa uma parcela ou abate o saldo, com desfazer. No front, `frontend/src/dividas.ts` (puro, testado em Node) junta numa lista só as dívidas cadastradas, as compras parceladas no cartão e o que você deve a pessoas, e calcula juros, peso, data de fim, sugestões de pagamento, simulação e ordem; `paginas/Dividas.tsx` desenha.

**Tech Stack:** Rust (axum, serde_json, `cargo test`); React 18 + TypeScript 5.5; testes Node (`npm run teste`).

**Spec:** `docs/superpowers/specs/2026-11-19-remodelagem-design.md` (seção 4). Protótipo: `docs/prototipos/2026-11-19-remodelagem.html` (tela Dívidas, `telaDividas()`, `janelaTipo()`). Depende das fases 1-3 (publicadas).

## Global Constraints

- Branch `v4`. Publicar só com o OK do usuário.
- Tipos padrão (não apagam): `cartao` "Cartão parcelado" (compras parceladas no cartão, lidas das faturas — como hoje em `parcelasCartao`), `emprestimo` "Empréstimos", `pessoas` "Com pessoas" (empréstimos em Pessoas com direção `eu_devo` e saldo > 0), `outras` "Outras dívidas". Tipo criado pelo usuário: `{ id: "t_<slug>", nome }` em `dividas.json` → `tipos[]`, nome de 1 a 40 letras, único sem diferenciar maiúscula/acento/espaço (inclusive contra os padrões).
- Tipo de uma dívida cadastrada (`Divida.tipo`): `emprestimo`/`financiamento` → Empréstimos; `cartao`/`cartao_de_credito` → Cartão parcelado; um id de tipo criado → ele; qualquer outro valor (ipva, acordo, outros, vazio) → Outras dívidas. Apagar um tipo criado manda as dívidas dele para "outras".
- Taxa ao mês: `taxa_mensal` cadastrada (em %, 2,5 = 2,5%); sem ela, a implícita de `extra.ts` `taxaImplicita(valor_contratado, parcelas_total, parcela)` quando os três existem; senão desconhecida.
- Etiquetas: "Em atraso" (situação em atraso, ou próximo vencimento já passou e sem pagamento ligado no mês, ou dívida sem parcelas com saldo e `vencimento_original` passado); "Juros altos · X% ao mês" (taxa ≥ 3% ao mês); "Sem juros" (taxa 0); senão nenhuma.
- Por dívida: para quitar hoje = valor presente das parcelas que faltam (Price, taxa da dívida; sem taxa ou taxa 0 = soma das parcelas; sem parcelas = saldo); pagando até o fim = parcela × parcelas que faltam (sem parcelas = saldo); juros que faltam = diferença.
- Topo: Você deve (Σ pagando até o fim), Juros que faltam (Σ), Peso no mês = Σ parcelas do mês seguinte ÷ média do salário líquido dos últimos 3 holerites (sem holerite: média das receitas de categoria `salario` dos últimos 3 meses; sem nada: não mostra %), barra âmbar acima de 30%; Livre das parcelas = mês da última parcela entre as parceladas (dívidas sem parcelas listadas como "sem data").
- Sugestão de pagamento: lançamento `despesa` ou `pagamento_divida`, sem vínculo, data entre 10 dias antes e 10 dias depois de um vencimento esperado da dívida (o próximo vencimento ou os 2 anteriores), |valor| a no máximo 2% ou R$ 1,00 (o que for maior) da parcela, e o par (lançamento, dívida) não recusado. Só dívidas cadastradas com parcela. Aviso: "Achei um pagamento no banco. <descrição> · <data> · <valor>. É a parcela N de T de <dívida>?" com "Sim, é" (liga o lançamento à dívida) e "Não é" (grava a recusa).
- Efeito de ligar um lançamento a uma dívida cadastrada: com parcelas → `parcelas_restantes` − 1 (mínimo 0), `proximo_vencimento` + 1 mês, novo saldo estimado = último saldo − |valor| (mínimo 0) com data do lançamento; sem parcelas → novo saldo = último saldo − |valor|; saldo 0 → `situacao: "quitada"`. O vínculo guarda os valores anteriores (`divida_antes: { parcelas_restantes, proximo_vencimento, situacao }`) e o desfazer restaura e tira o saldo daquela data. Cada dívida guarda `pagamentos: [{ lancamento_id, data, valor }]`.
- Simulador "E se eu adiantar?": de R$ 0 a R$ 5.000 em passos de R$ 100; o valor vai para a dívida de maior taxa (> 0); mostra juros economizados e meses a menos (Price, parcela fixa); se quitar, mostra a sobra indo para a próxima da ordem.
- Ordem sugerida: taxa > 0 da maior para a menor; depois as em atraso; depois as sem juros; depois as de taxa desconhecida. Cada linha com o motivo ("6,3% ao mês é o juro mais caro", "em atraso, a multa cresce", "sem juros, siga as parcelas").
- Continuam na tela, abaixo: "Quando fico livre das dívidas" (`PlanoQuitacao`), "Parcelas já comprometidas" (gráfico) e o formulário de adicionar/editar (com o tipo num select dos tipos).
- Textos em português do Brasil; valores em R$ com vírgula; nenhuma cor solta.

## Review Focus

- Sim e depois desligar o lançamento (em Movimentos): a dívida volta exatamente ao que era (parcelas, próximo vencimento, saldo, situação).
- Dois lançamentos ligados à mesma dívida no mesmo mês: as duas parcelas baixam e desfazer um só restaura o dele.
- Dívida sem parcela (IPVA): sem sugestão automática; ligar à mão abate o saldo e quita no zero.
- Usuário sem holerite e sem salário classificado: o peso no mês não aparece (nada de divisão por zero).
- Apagar um tipo criado com dívidas: elas aparecem em "Outras dívidas".

---

### Task 1: Servidor — tipos, recusas e efeito do vínculo com dívida

**Files:**
- Create: `backend/src/dividas.rs`
- Modify: `backend/src/main.rs` (rotas `GET /api/dividas/tipos` não precisa: os tipos vêm em `dados/dividas`; `POST /api/dividas/tipos` {nome}, `DELETE /api/dividas/tipos/:id`, `POST /api/dividas/:id/recusar` {lancamento_id}; o handler de PATCH de lançamento aplica o efeito da dívida), `backend/src/lancamentos.rs` (efeito `divida` em `Efeitos`/`aplicar`, desfazer)

**Interfaces:**
- Produces:
  - `pub fn criar_tipo(dv: &mut Value, nome: &str, agora: &str) -> Result<Value, Falha>` (id `t_<slug>`, sufixo `_2`… se ocupado)
  - `pub fn apagar_tipo(dv: &mut Value, id: &str, agora: &str) -> Result<usize, Falha>` (dívidas do tipo → `tipo: "outras"`; padrão → `Falha::Invalido`)
  - `pub fn recusar(dv: &mut Value, divida_id: &str, lancamento_id: &str) -> Result<(), Falha>` (guarda em `recusados: [{ divida, lancamento }]`, sem repetir)
  - `pub fn pagar(dv: &mut Value, divida_id: &str, lanc: &Value) -> Result<Value /* divida_antes */, Falha>` e `pub fn desfazer_pagamento(dv: &mut Value, divida_id: &str, lancamento_id: &str, antes: &Value) -> Result<(), Falha>` com as regras das Global Constraints
  - `Efeitos` ganha `divida: Option<(String, bool)>` (id, ligar/desligar); `aplicar` chama `dividas::pagar` / `desfazer_pagamento` e grava `divida_antes` no vínculo
- [ ] **Step 1: Testes** em `dividas.rs`: `criar_tipo_valida_nome` (vazio, 41 letras, "empréstimos", "Cartão Parcelado" recusados), `apagar_tipo_move_para_outras`, `recusar_nao_repete`, `pagar_baixa_parcela_e_avanca_vencimento`, `pagar_sem_parcelas_abate_saldo_e_quita_no_zero`, `desfazer_restaura_exatamente`, `dois_pagamentos_no_mes_desfazer_um_restaura_so_o_dele`; em `lancamentos.rs`: `ligar_divida_gera_efeito_e_desligar_desfaz`. **Step 2:** ver falhar. **Step 3:** implementar (efeitos aplicados em memória; grava `dividas` antes de `movimentacoes`, como fixas/emprestimos). **Step 4:** `~/.cargo/bin/cargo test` sem warnings. **Step 5:** commit "Dívidas: tipos, recusas e pagamento ao ligar um lançamento".

### Task 2: Lógica da tela (`dividas.ts`)

**Files:**
- Create: `frontend/src/dividas.ts`, `frontend/testes/dividas.teste.ts`
- Modify: `frontend/src/api.ts` (`Divida` ganha `pagamentos?`, `recusados?` em `dividas.json` → `brutos.dividasTipos`, `brutos.dividasRecusados`; métodos `criarTipoDivida`, `apagarTipoDivida`, `recusarSugestao`), `frontend/src/paginas/Dividas.tsx` (exportar `parcelasCartao`/`parcelasInformadas` ou movê-las para `dividas.ts` sem mudar o comportamento)

**Interfaces:**
- Produces:
  - `const TIPOS_PADRAO: { id: "cartao" | "emprestimo" | "pessoas" | "outras"; nome: string }[]`
  - `tipoDaDivida(d: Divida, criados: { id: string }[]): string`
  - `interface DividaVista { id: string; origem: "cadastrada" | "cartao" | "pessoa"; tipo: string; nome: string; parcela: number | null; restantes: number; total: number | null; pagas: number | null; proxima: { valor: number; data: string } | null; taxa: number | null /* fração ao mês */; quitarHoje: number; ateOFim: number; juros: number; fim: string | null /* AAAA-MM */; atraso: boolean; etiqueta: "atraso" | "juros_altos" | "sem_juros" | null; pagamentos: { data: string; valor: number; texto: string }[] }`
  - `juntarDividas(b: Brutos, hoje: string): DividaVista[]`
  - `resumo(v: DividaVista[], b: Brutos, hoje: string): { deve: number; juros: number; peso: number | null /* fração */; parcelasDoMes: number; livre: string | null; semData: number }`
  - `sugestoesPagamento(b: Brutos, hoje: string): { lancamento: Movimentacao; divida: DividaVista; n: number; t: number | null }[]`
  - `simularAdiantar(v: DividaVista[], extra: number): { alvo: DividaVista | null; economia: number; mesesAMenos: number; quita: boolean; sobra: number; proxima: DividaVista | null } | null`
  - `ordemSugerida(v: DividaVista[]): { divida: DividaVista; motivo: string }[]`
- [ ] **Step 1: Testes** com dados de exemplo (empréstimo 412,80 × 12 com 6,3% → quitar hoje com 9 restantes ≈ 2.771,44 e juros ≈ 943,76; parcelamento sem juros; IPVA sem parcelas em atraso; pessoa `eu_devo` 700; tipo criado; dívida com tipo apagado → outras); `resumo` com e sem holerite; `sugestoesPagamento` acha "PARCELA EMPRESTIMO 412,80" a 3 dias do vencimento, ignora a 15 dias, ignora valor 450, ignora recusado e já ligado; simulador (adiantar 500 economiza juros e encurta meses; adiantar além do saldo quita e sobra); ordem. **Step 2-4:** RED, implementar, GREEN (`npm run teste && npm run build`). **Step 5:** commit "Lógica das dívidas: lista única, juros, peso, sugestões, simulador e ordem".

### Task 3: Tela Dívidas

**Files:**
- Modify: `frontend/src/paginas/Dividas.tsx` (reescrever o topo e a lista; manter plano, gráfico e formulário), `frontend/src/estilo.css`
- Create: `frontend/src/componentes/JanelaTipoDivida.tsx`

**Interfaces:**
- Consumes: Task 2; `api.editarLancamento` (fase 3) para "Sim, é" (`vinculo: { tipo: "divida", id }`); `api.recusarSugestao` para "Não é".
- Produces: tela como no protótipo — avisos de pagamento no topo (um por sugestão, botões "Não é" / "Sim, é", erro dentro do aviso); 4 cartões (Você deve, Juros que faltam, Peso no mês com barra, Livre das parcelas); abas Todas + tipos (padrões, criados) + "+ Novo tipo" (`JanelaTipoDivida`, nome; tipos criados com "Apagar tipo" e confirmação na página); lista por tipo com total do grupo; cada dívida em linha que abre: etiqueta, barra de parcelas pagas, "N de T pagas · R$ X por mês", próxima parcela e data; aberta: Para quitar hoje / Pagando até o fim / Juros que faltam e a lista de pagamentos; cartão "E se eu adiantar?" (controle deslizante e o texto das Global Constraints); "Ordem sugerida para quitar"; depois os painéis que já existem. O formulário de dívida ganha o select de tipo (padrões + criados).
- [ ] **Step 1: Implementar.** **Step 2: Verificar** — `npm run teste && npm run build`; no app local com `dados-exemplo` + uma dívida cadastrada com parcela e um lançamento parecido: ver o aviso, "Sim, é" baixa a parcela; desligar em Movimentos restaura; "Não é" some e não volta; criar e apagar tipo. **Step 3: Commit** "Tela de Dívidas por tipo, com confirmação de pagamentos, simulador e ordem".
