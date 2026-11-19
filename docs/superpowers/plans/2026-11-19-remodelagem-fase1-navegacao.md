# Remodelagem Fase 1 – Navegação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar cabeçalho e abas pelo menu novo (lateral recolhível no computador, barra de baixo com + no celular), barra fixa no topo e lançamento manual.

**Architecture:** Regras de navegação em `frontend/src/navegacao.ts` (puro, testado em Node); componentes `Menu.tsx`, `BarraTopo.tsx`, `Lancar.tsx` e a página `Mais.tsx` só desenham. `App.tsx` passa a montar o esqueleto novo e continua carregando os dados como hoje. No servidor, um único endpoint novo `POST /api/movimentacoes` para o lançamento manual, com a lógica em `backend/src/manuais.rs`.

**Tech Stack:** React 18 + TypeScript 5.5 + Vite 5; Rust (axum) com testes `cargo test`.

**Spec:** `docs/superpowers/specs/2026-11-19-remodelagem-design.md` (seção 1). Protótipo: `docs/prototipos/2026-11-19-remodelagem.html`.

## Global Constraints

- Trabalhar na branch `v4`, criada a partir de `v3`. Publicar como antes: `git push origin v4:main`, só com o OK do usuário.
- Ponto de troca computador/celular: largura 760 px (`@media (min-width:760px)`).
- Menu lateral: 232 px aberto, 72 px recolhido; preferência `localStorage` `tf-menu` = `recolhido` | `aberto` (padrão `aberto`). No celular a preferência é ignorada.
- Ordem do menu lateral: Lançar; Início, Movimentos, Dívidas, Objetivos; grupo "Organizar": Contas fixas, Pessoas; fim: Categorias, Salários, Ajustes. Análises entra na fase 5.
- Barra de baixo: Início, Movimentos, + (52 px, redondo, cor de destaque), Objetivos, Mais.
- Mais, nesta ordem: Dívidas, Contas fixas, Pessoas, Categorias, Ajustes, Salários.
- Endereços: `#inicio #movimentos #dividas #objetivos #fixas #pessoas #categorias #salarios #ajustes #mais`. Redirecionam: `#visao`→`#inicio`, `#gastos`→`#movimentos` (mantendo `/categoria`), `#enviar`→`#ajustes`, `#metas`→`#objetivos`; desconhecido → `#inicio`.
- Simples | Completo e Sair saem do cabeçalho e vão para Ajustes. As chaves `tf-modo`, `tf-ocultar`, `tf-ano`, `tf-mes` continuam.
- Textos em português do Brasil; valores em R$ com vírgula; datas dd/mm/aaaa na tela e `AAAA-MM-DD` na API.
- Cores e fontes: as variáveis que já existem em `estilo.css` (`--accent`, `--surface`, `--line`, `--warn`…). Nada de cor solta.

## Review Focus

- Favorito antigo `#gastos/mercado`: abre Movimentos já filtrado em `mercado`, sem tela em branco.
- Setas do mês com "Ano inteiro" escolhido: andam de ano em ano e continuam em "Ano inteiro".
- Valor digitado como `1.234,56`, `12,5` ou `12.50`: vira 1234.56, 12.5 e 12.5; `abc`, vazio ou zero não deixam salvar.
- Sincronização que falha (Pluggy fora): mensagem curta na barra, botão volta ao normal, nada trava.
- Menu recolhido e tela do celular: no celular aparece a barra de baixo mesmo com `tf-menu=recolhido`.

---

### Task 1: Regras de navegação (`navegacao.ts`)

**Files:**
- Create: `frontend/src/navegacao.ts`
- Create: `frontend/testes/navegacao.teste.ts`
- Modify: `frontend/package.json` (script `teste` roda todos os `testes/*.teste.ts`)

**Interfaces:**
- Produces:
  - `type Tela = "inicio" | "movimentos" | "dividas" | "objetivos" | "fixas" | "pessoas" | "categorias" | "salarios" | "ajustes" | "mais"`
  - `telaDoEndereco(hash: string): { tela: Tela; detalhe: string | null }` (hash com ou sem `#`; `detalhe` é o que vem depois da `/`)
  - `enderecoCanonico(hash: string): string | null` (o hash novo quando o atual é antigo ou desconhecido; `null` se já está certo)
  - `abaDoCelular(t: Tela): "inicio" | "movimentos" | "objetivos" | "mais"`
  - `const MENU_PRINCIPAL: [Tela, string][]`, `MENU_ORGANIZAR`, `MENU_FIM`, `MENU_MAIS` com a ordem das Global Constraints
  - `mesVizinho(ano: number, mes: number | null, passo: 1 | -1): { ano: number; mes: number | null }`
  - `contarPendentes(movs: { natureza: string; categoria?: string | null; data: string; competencia?: string | null }[], ano: number, mes: number | null): number` — conta `natureza` `receita`, `despesa` ou `estorno` com categoria vazia ou `a_classificar`, na competência do período
  - `lerValor(txt: string): number | null`

- [ ] **Step 1: Escrever os testes** em `frontend/testes/navegacao.teste.ts`, no mesmo estilo de `extra.teste.ts` (função `ok(cond, nome)` e `process.exit(1)` se houver falha):

```ts
ok(telaDoEndereco("#visao").tela === "inicio", "visao vira inicio");
ok(JSON.stringify(telaDoEndereco("#gastos/mercado")) === JSON.stringify({ tela: "movimentos", detalhe: "mercado" }), "gastos/mercado");
ok(telaDoEndereco("#qualquer").tela === "inicio", "desconhecido");
ok(telaDoEndereco("").tela === "inicio", "vazio");
ok(enderecoCanonico("#gastos/mercado") === "#movimentos/mercado", "canônico antigo");
ok(enderecoCanonico("#dividas") === null, "canônico já certo");
ok(abaDoCelular("dividas") === "mais" && abaDoCelular("salarios") === "mais" && abaDoCelular("objetivos") === "objetivos", "aba do celular");
ok(JSON.stringify(mesVizinho(2026, 12, 1)) === JSON.stringify({ ano: 2027, mes: 1 }), "dez → jan");
ok(JSON.stringify(mesVizinho(2026, 1, -1)) === JSON.stringify({ ano: 2025, mes: 12 }), "jan → dez");
ok(JSON.stringify(mesVizinho(2026, null, 1)) === JSON.stringify({ ano: 2027, mes: null }), "ano inteiro anda por ano");
const movs = [
  { natureza: "despesa", categoria: "a_classificar", data: "2026-11-03" },
  { natureza: "receita", categoria: null, data: "2026-11-05" },
  { natureza: "despesa", categoria: "a_classificar", data: "2026-10-30", competencia: "2026-11" },
  { natureza: "transferencia_interna", categoria: "a_classificar", data: "2026-11-06" },
  { natureza: "despesa", categoria: "mercado", data: "2026-11-07" },
  { natureza: "despesa", categoria: "a_classificar", data: "2026-10-02" },
];
ok(contarPendentes(movs, 2026, 11) === 3, "pendentes do mês (usa competência, ignora transferência)");
ok(contarPendentes(movs, 2026, null) === 4, "pendentes do ano");
ok(lerValor("1.234,56") === 1234.56 && lerValor("12,5") === 12.5 && lerValor("12.50") === 12.5 && lerValor("1.234") === 1234, "valores");
ok(lerValor("abc") === null && lerValor("") === null && lerValor("0") === null && lerValor("-5") === null, "valores inválidos");
```

- [ ] **Step 2: Trocar o script** `teste` em `frontend/package.json` para rodar cada arquivo:

`"teste": "for f in testes/*.teste.ts; do esbuild \"$f\" --bundle --platform=node --log-level=error --outfile=node_modules/.tmp/teste.js && node node_modules/.tmp/teste.js || exit 1; done"`

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd frontend && npm run teste`
Expected: falha de build, `Could not resolve "../src/navegacao"`.

- [ ] **Step 4: Implementar `frontend/src/navegacao.ts`** com as assinaturas acima. `lerValor`: com vírgula, pontos são milhar e a vírgula é decimal; sem vírgula, um único ponto seguido de 1 ou 2 dígitos no fim é decimal, senão pontos são milhar; resultado ≤ 0 ou não numérico → `null`; arredonda em 2 casas. `contarPendentes` usa `competencia ?? data.slice(0, 7)`.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd frontend && npm run teste`
Expected: todas as linhas `ok:` dos dois arquivos, saída 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/navegacao.ts frontend/testes/navegacao.teste.ts frontend/package.json
git commit -m "Regras da navegação nova: endereços, mês, pendentes e valor digitado"
```

### Task 2: Lançamento manual no servidor

**Files:**
- Create: `backend/src/manuais.rs`
- Modify: `backend/src/main.rs` (declarar `mod manuais;`, rota `.route("/movimentacoes", post(criar_lancamento))` antes de `/movimentacoes/nomear`)

**Interfaces:**
- Consumes: `crate::emprestimos::Falha` (como em `fixas.rs`), `id_aleatorio`, `agora_txt`, `app.escrita`, `app.arm.ler_json/gravar_valor` de `main.rs`.
- Produces:
  - `#[derive(Deserialize)] pub struct NovoLancamento { pub tipo: String /* "gasto" | "entrada" */, pub valor: f64, pub descricao: String, pub data: String /* AAAA-MM-DD */, pub conta_id: Option<String> /* None = dinheiro */ }`
  - `pub fn criar(movs: &mut Value, n: &NovoLancamento, id: String, agora: &str) -> Result<Value, Falha>` — devolve o lançamento gravado
  - `POST /api/movimentacoes` → 200 com o lançamento; 400 com a mensagem da `Falha::Invalido`
  - Lançamento gravado: `id`, `data`, `descricao`, `valor` (negativo para gasto), `natureza` (`despesa` | `receita`), `categoria: "a_classificar"`, `classificacao: "baixa"`, `status: "confirmado"`, `competencia` = mês da data, `conta_id` (ou `"dinheiro"`), `origem: { "manual": true }`

- [ ] **Step 1: Escrever os testes** em `#[cfg(test)] mod testes` dentro de `manuais.rs`:

```rust
#[test] fn gasto_vira_despesa_negativa() // tipo "gasto", valor 45.9, data "2026-11-19" → valor -45.9, natureza "despesa", competencia "2026-11", categoria "a_classificar", conta_id "dinheiro", origem.manual true; movs["movimentacoes"] cresce 1
#[test] fn entrada_vira_receita_positiva() // tipo "entrada", valor 200.0 → valor 200.0, natureza "receita"
#[test] fn recusa_invalidos() // valor 0.0, valor -3.0, descricao "  ", descricao com 121 letras, data "19/11/2026", tipo "outro" → todos Err(Falha::Invalido(_))
#[test] fn arredonda_centavos() // valor 10.005 → -10.01 (gasto)
#[test] fn arquivo_sem_lista() // movs = json!({}) → cria "movimentacoes": [ … ]
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && ~/.cargo/bin/cargo test manuais`
Expected: erro de compilação, `criar` não existe.

- [ ] **Step 3: Implementar `manuais::criar`** com as regras acima e o handler `criar_lancamento` em `main.rs` (trava `app.escrita`, lê e grava `movimentacoes`, atualiza `atualizado_em`), igual a `criar_fixa`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && ~/.cargo/bin/cargo test`
Expected: todos passam, inclusive os antigos.

- [ ] **Step 5: Commit**

```bash
git add backend/src/manuais.rs backend/src/main.rs
git commit -m "Lançamento manual: POST /api/movimentacoes"
```

### Task 3: Menu, barra do topo, + e tela Mais

**Files:**
- Create: `frontend/src/componentes/Menu.tsx`, `frontend/src/componentes/BarraTopo.tsx`, `frontend/src/componentes/Lancar.tsx`, `frontend/src/paginas/Mais.tsx`
- Modify: `frontend/src/api.ts` (método `criarLancamento`), `frontend/src/App.tsx` (esqueleto novo, troca `abaDoEndereco`/`ABAS` por `navegacao.ts`; Simples|Completo e Sair dentro do bloco de Ajustes), `frontend/src/estilo.css` (seção nova "Navegação V4" no fim; remover as regras `.tabs`, `header.top` e `.strip` que deixarem de ser usadas)

**Interfaces:**
- Consumes: tudo de `navegacao.ts` (Task 1); `POST /api/movimentacoes` (Task 2); `api.sincronizar()` já existente.
- Produces:
  - `api.criarLancamento(n: { tipo: "gasto" | "entrada"; valor: number; descricao: string; data: string; conta_id: string | null }): Promise<Movimentacao>`
  - `MenuLateral({ tela, recolhido, pendentes, aoRecolher, aoLancar })` e `BarraDeBaixo({ tela, aoLancar })` em `Menu.tsx`
  - `BarraTopo({ ano, mes, anos, aoMudarPeriodo(ano, mes), pendentes, aoPendentes, ocultar, aoOcultar, carregadoEm: Date | null, aoSincronizado })`
  - `Lancar({ pendentes, contas: { id: string; nome: string }[], aoFechar, aoSalvo, aoOrganizar })` — primeiro a escolha (gasto, entrada, organizar), depois o formulário
  - `Mais()` — lista `MENU_MAIS` com ícone, nome e uma linha de descrição, cada item é um link `#tela`

- [ ] **Step 1: `api.criarLancamento`** em `api.ts`, `POST /api/movimentacoes` com o corpo acima.

- [ ] **Step 2: `Menu.tsx`.** Ícones em SVG inline (traço 1,8, `currentColor`), os mesmos do protótipo (`P.inicio`, `P.movimentos`, `P.dividas`, `P.objetivos`, `P.fixas`, `P.pessoas`, `P.categorias`, `P.salarios`, `P.ajustes`, `P.mais`, `P.plus`, `P.rec`, `P.abrir`). Item atual com `aria-current="page"`; recolhido mostra só ícones com `title` igual ao nome; Movimentos mostra o número de pendentes quando > 0.

- [ ] **Step 3: `BarraTopo.tsx`.** Seletor de mês: botões ‹ e › usam `mesVizinho`; o nome do mês é um `<select>` com os 12 meses e "Ano inteiro" (e os anos de `anos`). Aviso de pendentes: botão âmbar "N para organizar" (no celular só "N"), verde "Tudo organizado" quando 0; clique chama `aoPendentes`. Atualizar: chama `api.sincronizar()`, ícone gira enquanto roda, em erro mostra a mensagem da exceção por 4 s; depois chama `aoSincronizado`. Texto "Atualizado às HH:MM" a partir de `carregadoEm`, só no computador. Olho igual ao atual (`IconeOlho`).

- [ ] **Step 4: `Lancar.tsx`.** Janela que sobe de baixo no celular e fica no centro no computador (classe `.janela`). Formulário: Valor (`inputmode="decimal"`, lido com `lerValor`), Descrição (obrigatória, até 120 letras), "Pago com" (Dinheiro + `contas`), Data (`<input type="date">`, padrão hoje). Botão Salvar desabilitado enquanto `lerValor` der `null` ou a descrição estiver vazia. Ao salvar: `api.criarLancamento`, depois `aoSalvo(mov)`. Esc e clique fora fecham.

- [ ] **Step 5: `App.tsx`.** Estrutura `.app` > `MenuLateral` + `.coluna` (`BarraTopo` + `<main>`) + `BarraDeBaixo`. `tela` vem de `telaDoEndereco(location.hash)`; no `hashchange` e no início, se `enderecoCanonico` não for `null`, trocar o endereço com `history.replaceState`. Mapear telas para as páginas que já existem: `inicio`→`VisaoGeral`/`Simples`/`VisaoGeralAntiga` (como hoje), `movimentos`→`Gastos` (repassando `detalhe` como categoria), `categorias`→o componente `Categorias` que hoje fica em Ajustes, `mais`→`Mais`. Pendentes = `contarPendentes(brutos.movimentacoes, anoVisto, mesVisto)`. `aoPendentes` e `aoOrganizar` levam a `#movimentos/a_classificar`. `aoSalvo` recarrega os dados, mostra o aviso "Lançado. Escolha a categoria em Movimentos." e leva a `#movimentos/a_classificar`. Contas para "Pago com": as contas de `brutos` (id e nome que a tela Ajustes já mostra). Simples|Completo e Sair passam para o topo do bloco de Ajustes.

- [ ] **Step 6: Estilos** na seção "Navegação V4" de `estilo.css`, com as medidas das Global Constraints e o visual do protótipo (classes `.side`, `.bottom`, `.appbar`, `.pchip`, `.janela`). Barra de baixo respeita `env(safe-area-inset-bottom)`.

- [ ] **Step 7: Verificar build e testes**

Run: `cd frontend && npm run teste && npm run build`
Expected: testes `ok`, build sem erro de tipo.

- [ ] **Step 8: Verificar no app local.** Subir o servidor como na memória do projeto (`env -i` com `FINANCEIRO_DADOS` numa cópia dos dados no scratchpad) e o front com `npm run dev`. Conferir: largura 1280 e 390; recolher o menu e recarregar (continua recolhido); `#gastos/mercado` vira `#movimentos/mercado`; ‹ › no "Ano inteiro"; lançar um gasto de `12,50` em Dinheiro e ver na lista de pendentes; contador de pendentes muda.

- [ ] **Step 9: Commit**

```bash
git add frontend/src
git commit -m "Menu novo: lateral recolhível, barra de baixo com +, barra do topo e tela Mais"
```
