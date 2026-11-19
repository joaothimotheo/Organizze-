# Remodelagem Fase 3 – Movimentos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela Movimentos com entradas e saídas, busca e filtros, modo rápido para pendentes e detalhes do lançamento (renomear, categoria, dividir em partes, ligar a dívida, pessoa ou conta fixa).

**Architecture:** No servidor, um módulo novo `backend/src/lancamentos.rs` concentra a edição de um lançamento (partes, vínculo, quem) em funções puras sobre `serde_json::Value`; `PATCH /api/movimentacoes/:id` passa a aceitar esses campos; a sincronização passa a preservar os campos do usuário; os totais por categoria somam por parte. No front, `frontend/src/movimentos.ts` (puro, testado em Node) filtra, agrupa e monta a fila do modo rápido; a página `paginas/Movimentos.tsx` e os componentes `JanelaCategoria`, `DetalhesLancamento` e `ModoRapido` desenham.

**Tech Stack:** Rust (axum, serde_json, `cargo test`); React 18 + TypeScript 5.5 + Vite; testes Node via esbuild (`npm run teste`).

**Spec:** `docs/superpowers/specs/2026-11-19-remodelagem-design.md` (seção 3). Protótipo: `docs/prototipos/2026-11-19-remodelagem.html` (tela Movimentos, `janela()`, `janelaDet()`, `janelaRapido()`). Depende das fases 1 e 2 (publicadas).

## Global Constraints

- Branch `v4`. Publicar só com o OK do usuário.
- Partes: 2 a 10 partes; cada parte `{ valor, categoria, subcategoria? }` com `valor` com o mesmo sinal do lançamento e diferente de zero; a soma das partes = valor do lançamento (diferença ≤ R$ 0,01); categoria de cada parte = grupo do tipo certo para a natureza (gasto ↔ despesa; entrada ↔ receita/estorno) ou `a_classificar`. Só para natureza `despesa`, `receita` ou `estorno`, e só depois de migrado.
- Com partes, o campo `categoria` do lançamento = categoria da parte de maior valor absoluto; se alguma parte for `a_classificar`, `categoria` = `a_classificar` (o lançamento continua pendente).
- Vínculo: `{ tipo: "divida" | "pessoa" | "fixa", id }`. Ligar a uma conta fixa marca a fixa como paga no mês da competência do lançamento; ligar a uma pessoa registra um pagamento no empréstimo dessa pessoa (valor = |valor|, data = data do lançamento, obs "Lançamento <nome>"); desligar desfaz o que foi feito. Ligar a dívida só guarda o vínculo (a fase 4 usa).
- `quem`: até 60 letras; vazio apaga.
- A sincronização nunca apaga o que o usuário escreveu: `nome`, `quem`, `partes`, `vinculo`, `detalhe_antigo` são preservados sempre, e `natureza/categoria/subcategoria/classificacao/recorrencia` como hoje.
- Endereços: `#movimentos` (aba Saídas), `#movimentos/entradas`, `#movimentos/saidas`, `#movimentos/tudo`, `#movimentos/pendentes` (aba Tudo, só sem categoria), `#movimentos/<id do grupo>` (aba do tipo do grupo, filtrada). A análise mês a mês de uma categoria (página `Gastos` atual) fica em `#movimentos/<id>/mes-a-mes`, com link na tela filtrada.
- Busca: sem diferenciar maiúscula e acento, em nome, descrição do banco, quem e nome da conta. Filtros: conta (as contas de `brutos.contas` + "Dinheiro") e valor (acima de 50, 100, 500).
- Lista agrupada por dia, mais recente primeiro, no período escolhido na barra do topo.
- Modo rápido: fila = pendentes do período (despesa, receita ou estorno sem categoria), mais antigos primeiro; um toque no grupo salva com `mesma_descricao: true` e passa ao próximo; Pular; no fim "Pronto! N organizados, M pulados."
- Textos em português do Brasil; valores em R$ com vírgula; nenhuma cor solta (variáveis de `estilo.css`, incluindo `--g1..--g8`).

## Review Focus

- Sincronização depois de uma edição: um lançamento dividido, ligado e com `quem` continua igual depois de sincronizar de novo.
- Dividir com centavos: R$ 312,45 em 250,00 + 62,45 aceita; 250,00 + 62,44 recusa com "as partes somam R$ 312,44, falta R$ 0,01".
- Desligar um lançamento de uma pessoa desfaz só o pagamento que ele criou, não outros pagamentos da mesma pessoa.
- Busca com acento ("farmacia" acha "Farmácia") e filtro de conta "Dinheiro" (lançamentos manuais sem conta).
- Favorito antigo `#movimentos/mercado` (fase 1) continua abrindo filtrado em Mercado.

---

### Task 1: Edição do lançamento no servidor (partes, vínculo, quem) e sincronização que preserva

**Files:**
- Create: `backend/src/lancamentos.rs`
- Modify: `backend/src/main.rs` (`NovaCategoria` ganha `partes` e `vinculo`; `reclassificar` usa `lancamentos::editar`), `backend/src/pluggy.rs` (`mesclar`, ~linha 490: preservar campos do usuário), `backend/src/calculos.rs` (`despesas_por_categoria` soma por parte), `backend/src/modelo.rs` se `Movimentacao` precisar ler `partes`

**Interfaces:**
- Produces:
  - `pub fn partes_de(m: &Value) -> Vec<(f64, String)>` — (valor, categoria) de cada parte, ou `[(valor, categoria)]` sem partes
  - `pub fn validar_partes(cats: &Value, natureza: &str, valor: f64, partes: &[Value]) -> Result<Vec<Value>, Falha>` — normaliza (arredonda centavos, tira subcategoria vazia)
  - `pub fn categoria_principal(partes: &[Value]) -> String`
  - `#[derive(Deserialize, Clone)] pub struct Vinculo { pub tipo: String, pub id: String }`
  - `pub struct Efeitos { pub fixa: Option<(String, String, bool)> /* id, mês, pago */, pub pagar_pessoa: Option<(String, f64, String, String)> /* id, valor, data, obs */, pub desfazer_pessoa: Option<(String, String)> /* id, pagamento_id */ }`
  - `pub fn editar(m: &mut Value, cats: &Value, partes: Option<Option<Vec<Value>>>, vinculo: Option<Option<Vinculo>>) -> Result<Efeitos, Falha>` — `Some(None)` remove; devolve os efeitos que o handler aplica em `fixas.json` / `emprestimos.json` (o id do pagamento criado volta para `m["vinculo"]["pagamento_id"]`)
  - `pub const CAMPOS_DO_USUARIO: [&str; 5] = ["nome", "quem", "partes", "vinculo", "detalhe_antigo"]`
  - `PATCH /api/movimentacoes/:id` aceita `partes: [{valor, categoria, subcategoria?}] | null` e `vinculo: {tipo, id} | null`, além do que já aceita

- [ ] **Step 1: Testes em `lancamentos.rs`:**

```rust
#[test] fn partes_validas_definem_categoria_principal() // despesa -312.45, partes -250.00 p_comida e -62.45 p_casa → categoria "p_comida"
#[test] fn partes_que_nao_fecham_sao_recusadas() // -250.00 + -62.44 → Err Invalido "as partes somam R$ 312,44, falta R$ 0,01"
#[test] fn parte_de_outro_tipo_ou_sinal_trocado_e_recusada() // grupo de entrada numa despesa; parte positiva numa despesa; 1 parte; 11 partes; parte zero
#[test] fn parte_pendente_deixa_o_lancamento_pendente() // uma parte a_classificar → categoria "a_classificar"
#[test] fn partes_so_depois_de_migrar_e_so_em_gasto_ou_entrada() // não migrado → Err; natureza transferencia_interna → Err
#[test] fn remover_partes_volta_categoria_unica() // Some(None) apaga partes e mantém categoria principal
#[test] fn ligar_fixa_gera_efeito_no_mes_da_competencia() // competencia "2026-11" → Efeitos.fixa = (id, "2026-11", true); desligar → (id, "2026-11", false)
#[test] fn ligar_pessoa_gera_pagamento_e_desligar_desfaz_so_o_dele() // valor -95 → pagar_pessoa (id, 95.0, data, "Lançamento <nome>"); depois de gravar pagamento_id "pg1", desligar → desfazer_pessoa (id, "pg1")
#[test] fn ligar_divida_so_guarda() // Efeitos vazio, m["vinculo"] = {tipo:"divida", id}
#[test] fn partes_de_sem_partes_devolve_o_proprio() // [(valor, categoria)]
```

E em `pluggy.rs`: `#[test] fn sincronizar_de_novo_preserva_campos_do_usuario()` — antigo com nome, quem, partes, vinculo, detalhe_antigo e categoria "a_classificar" → todos preservados no novo; em `calculos.rs`: `#[test] fn gasto_por_categoria_soma_por_parte()`.

- [ ] **Step 2: Ver falhar** — `cd backend && ~/.cargo/bin/cargo test lancamentos` (não compila).
- [ ] **Step 3: Implementar** `lancamentos.rs`; o handler `reclassificar` lê `categorias.json`, chama `editar`, aplica os efeitos com `fixas::marcar_pago` e `emprestimos::pagar` / a função de desfazer pagamento já usada pela rota `DELETE /emprestimos/:id/pagamentos/:pid`, e grava `movimentacoes` por último (tudo sob `app.escrita`). Erro no efeito → nada é gravado.
- [ ] **Step 4: Ver passar** — `~/.cargo/bin/cargo test` sem warnings.
- [ ] **Step 5: Commit** — `git commit -m "Lançamento: partes, vínculo e quem; sincronização preserva o que você escreveu"`

### Task 2: Lógica da tela Movimentos (`movimentos.ts`)

**Files:**
- Create: `frontend/src/movimentos.ts`, `frontend/testes/movimentos.teste.ts`
- Modify: `frontend/src/api.ts` (`Movimentacao` ganha `partes?`, `vinculo?`, `quem?`; `api.editarLancamento(id, campos)` → `PATCH /api/movimentacoes/:id`), `frontend/src/gastos.ts` e `frontend/src/grupos.ts` (somas por categoria usam `partesDe`)

**Interfaces:**
- Produces:
  - `type Aba = "entradas" | "saidas" | "tudo"`
  - `interface Filtro { aba: Aba; busca: string; conta: string | null /* id, "dinheiro" ou null */; valorMin: 0 | 50 | 100 | 500; grupo: string | null; soPendentes: boolean }`
  - `rotaMovimentos(hash: string, grupos: Grupo[]): { filtro: Partial<Filtro>; mesAMes: string | null }` (endereços das Global Constraints)
  - `normalizar(txt: string): string` (minúscula, sem acento, espaços simples)
  - `filtrar(movs: Movimentacao[], f: Filtro, nomeConta: (id?: string | null) => string): Movimentacao[]`
  - `porDia(movs: Movimentacao[]): { dia: string; itens: Movimentacao[] }[]` (dia `AAAA-MM-DD`, desc; dentro do dia, maior |valor| primeiro)
  - `partesDe(m: Movimentacao): { valor: number; categoria: string }[]`
  - `resumo(movs: Movimentacao[], grupos: Grupo[], tipo: "gasto" | "entrada"): { grupo: Grupo; total: number }[]` (por parte; maior primeiro)
  - `filaRapida(movs: Movimentacao[]): string[]` (ids dos pendentes, mais antigos primeiro)
  - `conferirPartes(valor: number, partes: { valor: number }[]): { ok: boolean; texto: string }` (mesmas mensagens do servidor)

- [ ] **Step 1: Testes** em `movimentos.teste.ts` com 12 lançamentos de exemplo (entradas, saídas, uma transferência interna, um estorno, um manual em Dinheiro, um dividido): abas; busca "farmacia" acha "FARMÁCIA"; conta "dinheiro" acha só o manual; valor acima de 100; grupo; só pendentes; `porDia` ordenado; `resumo` dividindo o lançamento em partes; `filaRapida` em ordem de data; `conferirPartes(-312.45, [-250, -62.44])` → `{ ok: false, texto: "as partes somam R$ 312,44, falta R$ 0,01" }`; `rotaMovimentos("#movimentos/mercado", grupos)` → grupo "mercado" na aba saídas; `"#movimentos/p_x/mes-a-mes"` → `mesAMes: "p_x"`; `"#movimentos/pendentes"` → aba tudo + soPendentes.
- [ ] **Step 2: Ver falhar**, **Step 3: Implementar**, **Step 4: Ver passar** — `cd frontend && npm run teste && npm run build`.
- [ ] **Step 5: Commit** — `git commit -m "Lógica da tela Movimentos: filtros, busca, dias, resumo e fila do modo rápido"`

### Task 3: Tela Movimentos

**Files:**
- Create: `frontend/src/paginas/Movimentos.tsx`
- Modify: `frontend/src/App.tsx` (`#movimentos…` mostra `Movimentos`; `…/mes-a-mes` mostra a `Gastos` atual com a categoria), `frontend/src/navegacao.ts` (`destinoPendentes` passa a devolver sempre `"#movimentos/pendentes"`; entrada manual salva leva a `#movimentos/entradas`), `frontend/testes/navegacao.teste.ts`, `frontend/src/estilo.css`

**Interfaces:**
- Consumes: Task 2 inteira; `SeletorCategoria` (fase 2) para a troca rápida na linha.
- Produces: `Movimentos({ brutos, ano, mes, aoMudar })`, como no protótipo: abas com "· N a organizar"; chips de resumo (toque filtra); busca; botão Filtros (abre conta e valor, mostra "(N)" ativos); filtros ativos como pílulas com ×; botão "Organizar um por um (N)" (abre o modo rápido da Task 4 — nesta task, só o botão chamando a prop `aoOrganizar`); lista por dia; cada linha: nome (botão que abre detalhes — prop `aoAbrir(id)`), conta e descrição do banco, botão de categoria (pílula; âmbar tracejada "De onde veio?" / "Escolher categoria" quando pendente; "· não conta" quando a natureza não conta), "de <quem>", "Ligado a <nome>", valor. Com grupo filtrado: link "Ver mês a mês".

- [ ] **Step 1: Implementar** a tela e as rotas. **Step 2:** atualizar os testes de `navegacao.ts` para o destino novo. **Step 3: Verificar** — `npm run teste && npm run build`. **Step 4: Commit** — `git commit -m "Tela Movimentos: entradas e saídas, busca, filtros e lista por dia"`

### Task 4: Janelas: categoria, detalhes e modo rápido

**Files:**
- Create: `frontend/src/componentes/JanelaCategoria.tsx`, `frontend/src/componentes/DetalhesLancamento.tsx`, `frontend/src/componentes/ModoRapido.tsx`
- Modify: `frontend/src/paginas/Movimentos.tsx` (liga as janelas), `frontend/src/estilo.css`

**Interfaces:**
- Consumes: Tasks 1-3; `api.editarLancamento`; `NATUREZAS_NAO_CONTA`; `JanelaGrupo` (fase 2) para "+ Novo grupo".
- Produces:
  - `JanelaCategoria({ mov, grupos, aoSalvo, aoFechar })`: grade de grupos do tipo certo + "+ Novo grupo"; detalhes do grupo (opcional); "Não é gasto/ganho" com as naturezas que não contam (muda a natureza); "Quem mandou"/"Para quem" quando entrada ou grupo com `pede_pessoa`; caixa "Usar a mesma escolha nos próximos de "<nome>"" ligada (`mesma_descricao`).
  - `DetalhesLancamento({ mov, brutos, aoSalvo, aoFechar })`: nome (vazio = volta ao do banco), categoria (select do tipo certo), "Dividir em partes" (2 a 10 linhas valor + categoria, "+ Outra parte", "Desfazer divisão", aviso de `conferirPartes`, Salvar desabilitado até fechar), "Ligar a" (select com grupos Dívidas, Pessoas, Contas fixas; "Nada" desliga) e o texto explicando o efeito.
  - `ModoRapido({ fila, brutos, aoFim, aoFechar })`: "N de M", barra, lançamento grande, grade de grupos (um toque salva e avança), naturezas que não contam, "Quem" quando entrada ou Pix, Pular, Sair; tela final.
- [ ] **Step 1: Implementar.** Erros da API aparecem dentro da janela; Esc e clique fora fecham (exceto enquanto salva).
- [ ] **Step 2: Verificar** — `npm run teste && npm run build`; no app local com uma cópia de `dados-exemplo` migrada mais lançamentos sintéticos: dividir 312,45 em 250 + 62,45; ligar um Pix a uma pessoa e ver o pagamento em Pessoas; desligar; modo rápido até o fim; busca "farmacia".
- [ ] **Step 3: Commit** — `git commit -m "Janelas de categoria, detalhes do lançamento e modo rápido"`
