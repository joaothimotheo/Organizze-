# Remodelagem Fase 2 – Categorias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar as 24 categorias fixas por grupos criados pelo usuário (gastos) e origens (entradas), com migração de uma vez e sugestões a partir de "Outros gastos".

**Architecture:** `categorias.json` ganha a versão 2 (`versao: 2`, `grupos[]`, `mapa{}`). Toda a regra fica em `backend/src/categorias.rs` (funções puras sobre `serde_json::Value`, testadas com `cargo test`); `main.rs` só expõe as rotas. O classificador continua com as regras por palavra-chave nas chaves antigas e passa a traduzir pelo `mapa`. No front, `frontend/src/grupos.ts` (puro, testado) decide o que é gasto e o que é entrada; `paginas/Categorias.tsx` e `paginas/Migracao.tsx` desenham.

**Tech Stack:** Rust (axum, serde_json, `cargo test`); React 18 + TypeScript 5.5.

**Spec:** `docs/superpowers/specs/2026-11-19-remodelagem-design.md` (seção 2). Depende da fase 1 (tela `#categorias` no menu).

## Global Constraints

- Branch `v4`. Publicar só com o OK do usuário.
- Grupos padrão (não apagam, não renomeiam para nome de outro): gasto `outros` "Outros gastos"; entrada `salario` "Salário", `renda_extra` "Renda extra", `pix_pessoas` "Pix de pessoas", `rendimentos_estornos` "Rendimentos e estornos" (detalhes "Rendimentos", "Estorno", "Venda"), `outras_entradas` "Outras entradas".
- Sentinela de "sem categoria": continua `a_classificar`.
- Grupo do usuário: `{ id: "p_<slug>", nome, tipo: "gasto" | "entrada", cor: "g1".."g8", detalhes: [string], pede_pessoa: bool, padrao: false }`. Nome de 1 a 40 letras, único entre todos os grupos sem diferenciar maiúscula, acento e espaços repetidos. Até 20 detalhes de até 40 letras.
- Cores `g1`..`g8`: tokens novos `--g1`..`--g8` em `estilo.css`, com valores claro/escuro iguais aos do protótipo.
- Migração: marcadas por padrão as categorias de gasto com 15 usos ou mais nos últimos 12 meses (contando `natureza` `despesa`). Desmarcada → `outros` com `subcategoria` = nome antigo (se o lançamento já tinha subcategoria, ela é mantida e o nome antigo vai para `detalhe_antigo`). `transferencias_pix` → `outros` com subcategoria "Pix no cartão", nunca vira grupo. Receitas: `salario`→`salario`, `outras_receitas`→`outras_entradas`, `investimentos`→`rendimentos_estornos` com subcategoria "Rendimentos". `natureza` `estorno` → `rendimentos_estornos` com subcategoria "Estorno". `classificacao` e `nome` dos lançamentos não mudam.
- `natureza` nova aceita: `emprestimo_concedido`, `emprestimo_devolvido`.
- Estorno conta como entrada (não abate mais gasto).
- Sugestão: 3 ou mais lançamentos em `outros` com o mesmo `subcategoria`, com data nos últimos 90 dias.

## Review Focus

- Migrar duas vezes (duplo clique, duas abas): a segunda resposta é 409 "as categorias já foram migradas" e nada muda.
- Categoria antiga que estava oculta (excluída pelo usuário) mas ainda tem lançamentos: os lançamentos vão para `outros` com o nome antigo como detalhe; não aparece na lista para marcar.
- Lançamento de categoria própria antiga (`p_…`) : a categoria própria vira grupo com o mesmo id se marcada, senão vai para `outros` com o nome dela.
- Sincronização rodando logo depois da migração: regra `assinaturas` sem grupo correspondente cai em `a_classificar`, sem erro; com grupo, cai no grupo.
- Grupo novo com o nome de um padrão ("salário", "OUTROS GASTOS"): recusado com 400 "já existe um grupo com esse nome".

---

### Task 1: Modelo de grupos e migração no servidor

**Files:**
- Modify: `backend/src/categorias.rs` (nova seção "Versão 2"; as funções antigas continuam para arquivos ainda não migrados)
- Test: no próprio arquivo, `mod testes`

**Interfaces:**
- Produces:
  - `pub const PADRAO: [(&str, &str, &str); 6]` = (id, nome, tipo)
  - `pub fn migrado(cats: &Value) -> bool` (`versao == 2`)
  - `pub fn grupos(cats: &Value) -> Vec<Value>` — padrões primeiro, depois os do usuário em ordem alfabética, `outros` e `outras_entradas` por último no seu tipo; campos `id, nome, tipo, cor, detalhes, pede_pessoa, padrao`
  - `pub struct UsoAntigo { pub id: String, pub nome: String, pub usos: u32, pub marcada: bool }`
  - `pub fn uso_antigo(cats: &Value, movs: &Value, hoje: &str) -> Vec<UsoAntigo>` — só categorias de gasto (fixas não ocultas, exceto `transferencias_pix`, `transferencias`, `investimentos`, `emprestimos`, `salario`, `outras_receitas`, `outros`, `a_classificar`; mais as próprias `p_…`), maior uso primeiro
  - `pub struct ResumoMigracao { pub grupos: usize, pub movidos: usize }`
  - `pub fn migrar(cats: &mut Value, movs: &mut Value, manter: &[String], agora: &str) -> Result<ResumoMigracao, Falha>` — `Falha::Conflito(String)` se já migrado (variante nova em `emprestimos::Falha`, `backend/src/emprestimos.rs:15`; mapear para 409 junto das outras em `main.rs:379-380`); grava `versao: 2`, `grupos`, `mapa` (chave antiga → id do grupo, só para as mantidas e para `salario`, `outras_receitas`, `investimentos`), `migrado_em`
  - `pub fn mapa(cats: &Value) -> HashMap<String, String>`
  - `pub fn categoria_final(mapa: &HashMap<String, String>, natureza: &str, categoria: &str) -> String` — `estorno` → `rendimentos_estornos`; chave no mapa → grupo; id já de grupo → ele mesmo; resto → `a_classificar`

- [ ] **Step 1: Testes** (dados montados com `json!`, hoje = `"2026-11-19"`):

```rust
#[test] fn uso_antigo_conta_12_meses_e_marca_15() // 16 "mercado" em 2026, 3 "educacao", 20 "mercado" em 2025-10 (fora) → mercado usos 16 marcada; educacao 3 não marcada; transferencias_pix não aparece
#[test] fn migrar_mantidas_viram_grupo() // manter ["mercado"] → grupo id "mercado" nome "Mercado" tipo "gasto"; lançamento mercado continua "mercado"
#[test] fn migrar_desmarcadas_vao_para_outros_com_detalhe() // "educacao" → categoria "outros", subcategoria "Educação"; com subcategoria "curso" → subcategoria "curso", detalhe_antigo "Educação"
#[test] fn migrar_pix_no_cartao() // transferencias_pix → outros / "Pix no cartão", mesmo se vier em manter
#[test] fn migrar_receitas_e_estorno() // salario→salario; outras_receitas→outras_entradas; receita investimentos→rendimentos_estornos/"Rendimentos"; natureza estorno (cat outros)→rendimentos_estornos/"Estorno"
#[test] fn migrar_preserva_manual_e_nome() // classificacao "manual" e nome "Feira" continuam iguais
#[test] fn migrar_duas_vezes_e_conflito() // segunda chamada → Err(Falha::Conflito(_)), movs igual ao da primeira
#[test] fn categoria_final_usa_mapa() // mapa {assinaturas: p_assinaturas}; ("despesa","assinaturas")→"p_assinaturas"; ("despesa","lazer")→"a_classificar"; ("estorno","outros")→"rendimentos_estornos"; ("despesa","p_carro") com p_carro existindo → "p_carro"
```

- [ ] **Step 2: Rodar e ver falhar** — `cd backend && ~/.cargo/bin/cargo test categorias` → não compila (funções ausentes).
- [ ] **Step 3: Implementar** as funções acima em `categorias.rs`. Reaproveitar `slug`, `chave` e `validar_nome`.
- [ ] **Step 4: Rodar e ver passar** — `~/.cargo/bin/cargo test` → todos passam.
- [ ] **Step 5: Commit** — `git commit -m "Categorias v2: grupos, migração e mapa das chaves antigas"`

### Task 2: Criar, editar, apagar grupos e sugestões

**Files:**
- Modify: `backend/src/categorias.rs`

**Interfaces:**
- Consumes: `grupos`, `migrado` (Task 1)
- Produces:
  - `#[derive(Deserialize)] pub struct NovoGrupo { pub nome: String, pub tipo: String, pub cor: String, #[serde(default)] pub detalhes: Vec<String>, #[serde(default)] pub pede_pessoa: bool, #[serde(default)] pub absorver_detalhe: Option<String> }`
  - `pub fn criar_grupo(cats: &mut Value, movs: &mut Value, n: &NovoGrupo, agora: &str, hoje: &str) -> Result<(Value, usize), Falha>` — devolve o grupo e quantos lançamentos vieram de `outros` (os da sugestão `absorver_detalhe`, últimos 90 dias e anteriores também; o detalhe vira o primeiro de `detalhes` se não estiver lá)
  - `pub fn editar_grupo(cats: &mut Value, id: &str, n: &NovoGrupo, agora: &str) -> Result<Value, Falha>` — padrão só muda `detalhes` e `cor`
  - `pub fn apagar_grupo(cats: &mut Value, movs: &mut Value, id: &str, agora: &str) -> Result<usize, Falha>` — padrão → `Falha::Invalido`; lançamentos vão para `outros`/`outras_entradas` com `subcategoria` = nome do grupo; entradas do `mapa` que apontavam para ele são removidas
  - `pub fn sugestoes(cats: &Value, movs: &Value, hoje: &str) -> Vec<Value>` — `{ detalhe, lancamentos: [id], total }`, maior total primeiro, ignorando detalhe que já é nome de grupo

- [ ] **Step 1: Testes**

```rust
#[test] fn criar_grupo_valida_nome() // "" , 41 letras, "salário", "  OUTROS   gastos " → Err(Invalido); cor "g9" → Err; tipo "x" → Err
#[test] fn criar_grupo_com_sugestao_absorve() // 3 outros/"Saúde" em out-nov + 1 em 2026-01 → criar "Saúde" absorver "Saúde" → 4 movidos, categoria "p_saude", subcategoria "Saúde"
#[test] fn apagar_grupo_devolve_para_outros() // grupo p_carro com 2 lançamentos → 2, categoria "outros", subcategoria "Carro"; apagar "outros" → Err
#[test] fn editar_padrao_so_detalhes_e_cor() // editar "salario" com nome "Pagamento" → nome continua "Salário", cor muda
#[test] fn sugestoes_minimo_3_em_90_dias() // 3 "Saúde" (out e nov) → sugere; 2 "Uber" → não; 3 "Farmácia" em 2026-06 → não; 3 "Carro" com grupo "Carro" existente → não
```

- [ ] **Step 2: Ver falhar** — `cargo test categorias`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Ver passar** — `cargo test`.
- [ ] **Step 5: Commit** — `git commit -m "Grupos: criar, editar, apagar e sugestões a partir de Outros"`

### Task 3: Rotas, classificador e sincronização usando os grupos

**Files:**
- Modify: `backend/src/main.rs` (rotas e `reclassificar`), `backend/src/importar/classificar.rs` (`Classificador::com_mapa`), `backend/src/pluggy.rs:622` e `backend/src/importar/mod.rs:141` (passar o mapa e chamar `categoria_final`)

**Interfaces:**
- Consumes: Tasks 1 e 2.
- Produces:
  - `GET /api/categorias` → `{ "migrado": bool, "grupos": [...] }` se migrado; senão `{ "migrado": false, "grupos": <todas() antigas> }`
  - `GET /api/categorias/migracao` → `[UsoAntigo]`; `POST /api/categorias/migrar { "manter": [id] }` → `ResumoMigracao`; 409 se já migrado
  - `POST /api/categorias` (`NovoGrupo`) → `{ "grupo": {...}, "movidos": n }`; `PUT /api/categorias/:id` (`NovoGrupo`); `DELETE /api/categorias/:id` → `{ "movidos": n }`; `GET /api/categorias/sugestoes`
  - `PATCH /api/movimentacoes/:id` aceita também `natureza` (uma de `receita, despesa, estorno, transferencia_interna, aporte_investimento, resgate_investimento, pagamento_divida, emprestimo_recebido, emprestimo_concedido, emprestimo_devolvido`) e `quem` (texto até 60 letras); com `categoria` de um grupo de tipo diferente da natureza → 400
  - `Classificador::com_mapa(self, mapa: HashMap<String, String>) -> Self`; com mapa, `classificar` devolve `categoria_final` do resultado das regras (o aprendido já está em ids novos)
  - A rota `/categorias/:id/restaurar` some quando migrado (404).

- [ ] **Step 1: Testes em `classificar.rs`**

```rust
#[test] fn com_mapa_traduz_regra() // mapa {assinaturas: p_assinaturas}; "NETFLIX.COM" → "p_assinaturas"; "POSTO SHELL" (transporte, sem mapa) → "a_classificar"
#[test] fn com_mapa_respeita_aprendido() // aprendido "IFOOD" → "p_comida" (manual) → "p_comida"
```

- [ ] **Step 2: Ver falhar**, **Step 3: Implementar** rotas e chamadas (`pluggy.rs` e `importar/mod.rs` leem `categorias.json` uma vez e passam `categorias::mapa`; se não migrado, mapa vazio e comportamento antigo), **Step 4: Ver passar** — `cargo test`.
- [ ] **Step 5: Verificar com dados reais copiados.** Copiar os dados de produção (backup em Ajustes → baixar) para o scratchpad, subir o servidor local com `FINANCEIRO_DADOS` apontando para a cópia, chamar `GET /api/categorias/migracao`, `POST /api/categorias/migrar` com as marcadas e conferir que a soma dos gastos do ano em `GET /api/visao-geral` (natureza despesa) é a mesma de antes, e que as receitas aumentaram exatamente o total dos estornos.
- [ ] **Step 6: Commit** — `git commit -m "Rotas de grupos e migração; classificador e sincronização pelo mapa"`

### Task 4: Regras de gasto e entrada no front

**Files:**
- Create: `frontend/src/grupos.ts`, `frontend/testes/grupos.teste.ts`
- Modify: `frontend/src/gastos.ts` (`ehGasto` passa a ser só `despesa`), `frontend/src/paginas/VisaoGeral.tsx` e `frontend/src/paginas/Simples.tsx` (usar `ehGasto`/`ehEntrada` de `grupos.ts`), `frontend/src/api.ts` (tipos `Grupo`, `UsoAntigo`, métodos novos)

**Interfaces:**
- Produces:
  - `interface Grupo { id: string; nome: string; tipo: "gasto" | "entrada"; cor: string; detalhes: string[]; pede_pessoa: boolean; padrao: boolean }`
  - `ehGasto(m): boolean` (`despesa`), `ehEntrada(m): boolean` (`receita` | `estorno`), `naoConta(m): boolean` (as demais naturezas)
  - `semCategoria(m): boolean` (categoria vazia ou `a_classificar`, e `ehGasto || ehEntrada`)
  - `NATUREZAS_NAO_CONTA: { saida: [natureza, nome, texto][]; entrada: [...] }` com os nomes da spec
  - `api.categorias(): Promise<{ migrado: boolean; grupos: Grupo[] }>`, `api.usoAntigo()`, `api.migrar(manter)`, `api.criarGrupo(n)`, `api.editarGrupo(id, n)`, `api.apagarGrupo(id)`, `api.sugestoes()`

- [ ] **Step 1: Testes** — `ehEntrada({natureza:"estorno"}) === true`, `ehGasto({natureza:"estorno"}) === false`, `naoConta({natureza:"emprestimo_concedido"}) === true`, `semCategoria({natureza:"transferencia_interna", categoria:"a_classificar"}) === false`, `semCategoria({natureza:"despesa", categoria:null}) === true`.
- [ ] **Step 2: Ver falhar** — `npm run teste`. **Step 3: Implementar.** **Step 4: Ver passar.**
- [ ] **Step 5: `contarPendentes` da fase 1** passa a usar `semCategoria` (o teste da fase 1 continua passando).
- [ ] **Step 6: Commit** — `git commit -m "Front: estorno conta como entrada; regras de gasto, entrada e não conta"`

### Task 5: Telas Categorias e Migração

**Files:**
- Create: `frontend/src/paginas/Categorias.tsx`, `frontend/src/paginas/Migracao.tsx`, `frontend/src/componentes/JanelaGrupo.tsx`
- Modify: `frontend/src/App.tsx` (`#categorias` mostra `Migracao` enquanto `migrado` for `false`, senão `Categorias`; aviso no Início "Organize as suas categorias" com link enquanto não migrado), `frontend/src/estilo.css` (tokens `--g1`..`--g8` claro e escuro), remover `frontend/src/componentes/Categorias.tsx` antigo e o uso dele em Ajustes

**Interfaces:**
- Consumes: Task 4 (`api.*`, `Grupo`), Task 3 (rotas).
- Produces: telas como no protótipo, aba Categorias:
  - "Seus grupos de gasto" com uso no mês (vezes e valor), botão Criar grupo, Apagar nos do usuário (confirmação dentro da página: "Os N lançamentos vão para Outros gastos")
  - "Sugestões a partir de Outros gastos" com Criar (chama `criarGrupo` com `absorver_detalhe`)
  - "Entradas: de onde veio" com Criar origem
  - "Não contam no mês" (lista fixa de `NATUREZAS_NAO_CONTA`)
  - `JanelaGrupo({ tipo, inicial?, aoSalvar, aoFechar })`: nome, 8 cores, detalhes separados por vírgula, "Pedir para quem" (só gasto)
  - `Migracao`: lista de `usoAntigo` com caixas (marcadas as `marcada`), texto da spec, botão "Usar estas categorias"; ao terminar mostra "N grupos criados, M lançamentos reorganizados" e recarrega

- [ ] **Step 1: Implementar** as telas.
- [ ] **Step 2: Verificar** — `npm run teste && npm run build` sem erro.
- [ ] **Step 3: Verificar no app local** com a cópia dos dados reais: migrar, criar "Carro" com detalhes, aceitar uma sugestão, apagar um grupo e ver os lançamentos em Outros; telas em 1280 e 390, claro e escuro.
- [ ] **Step 4: Commit** — `git commit -m "Telas Categorias e Migração"`
