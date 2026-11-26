# Avisos no celular e Fechamento do mês — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notificações Web Push (conta fixa vencendo, assinatura nova, fatura, resumo do mês) enviadas pelo próprio servidor depois de cada sincronização, e uma tela "Fechamento do mês" com PDF.

**Architecture:** O servidor ganha (1) as regras de contas fixas portadas do front, com casos de teste em JSON lidos pelos dois lados, (2) um módulo Web Push próprio (RFC 8291 + VAPID RFC 8292) e (3) uma função pura `verificar` chamada no fim de `POST /api/sincronizar`. O app ganha o tratamento de `push` no service worker, um card de Avisos nos Ajustes e a tela `#fechamento/AAAA-MM`, calculada no front.

**Tech Stack:** Rust (axum 0.7, reqwest rustls, serde_json) + crates novas `p256` (features `ecdh`, `ecdsa`), `aes-gcm`, `hkdf`; React 18 + TS + Vite; testes `cargo test` e `npm run teste` (esbuild + node, arquivos `frontend/testes/*.teste.ts`).

**Spec:** `docs/superpowers/specs/2026-11-19-avisos-fechamento-design.md`

## Global Constraints

- Português do Brasil em código, textos e commits; datas dd/mm/aaaa, valores `R$ 1.234,56` (use os formatadores existentes: `reais()` em `backend/src/emprestimos.rs`, `brl` do front).
- Nenhuma variável nova obrigatória no `.env`; opcional `FINANCEIRO_VAPID_ASSUNTO` (padrão `mailto:` + `FINANCEIRO_EMAIL`, senão `mailto:financeiro@localhost`).
- Nenhum cliente HTTP novo nem OpenSSL: envio pelo `reqwest` já existente.
- Toda rota nova exige login (fica dentro do `auth::exigir`); escritas exigem `x-financeiro: 1` (já garantido pelo middleware).
- Falha de aviso nunca faz `POST /api/sincronizar` falhar nem mudar seu código HTTP.
- O service worker continua sem cache de `/api/*`.
- Os avisos mostram valores (decisão do usuário), exceto o de resumo do mês (sem valor).
- O arquivo `avisos` (tem a chave privada VAPID e os endpoints) **não** pode ser lido por `GET /api/dados/:arquivo` nem aparecer em "fontes".
- Endereço da tela: `#fechamento/AAAA-MM` (padrão do app: `tela/detalhe`; o spec falava em `?mes=`, mesmo efeito).

## Review Focus

1. **Dia que não existe no mês** (fixa com `dia` 31 em novembro, 29–31 em fevereiro): vence no último dia do mês; a véspera é o penúltimo. → teste em Task 3.
2. **Virada de mês** (fixa com `dia` 1): a véspera é o último dia do mês anterior e a chave usa o mês do vencimento. → teste em Task 3.
3. **Cinco sincronizações no mesmo dia e dois aparelhos**: cada aviso sai uma vez só (por chave), para todos os aparelhos daquela vez. → teste em Task 3 e Task 4.
4. **Primeira verificação depois de publicar**: sugestões, faturas e fechamento já existentes viram semente sem envio; nada de rajada. → teste em Task 3.
5. **Aparelho desinstalado** (endpoint responde 404/410): o aparelho some da lista e a sincronização responde normal. → teste em Task 4.

---

### Task 1: Regras de contas fixas no servidor (porte do front, casos compartilhados)

**Files:**
- Create: `frontend/testes/casos/fixas.json` (casos compartilhados)
- Create: `frontend/testes/fixas.teste.ts`
- Modify: `backend/src/fixas.rs` (funções novas + testes lendo o JSON)

**Interfaces:**
- Produces (Rust, em `fixas.rs`):
  - `pub fn lugar(descricao: &str) -> String` — igual a `lugar` de `frontend/src/gastos.ts:84`.
  - `pub fn nome_limpo(chave: &str) -> String` — igual a `nomeLimpo` de `frontend/src/fixas.ts`.
  - `pub fn competencia(m: &Value) -> String` — `competencia` ou `data[..7]`.
  - `pub fn paga_no_mes(f: &Value, movs: &[Value], mes: &str) -> bool` — `pagos` contém `mes` **ou** `pagamentoNoBanco` acha lançamento.
  - `pub struct Sugestao { pub chave: String, pub nome: String, pub valor: f64, pub dia: u32, pub ultima: String }` (`Serialize`).
  - `pub fn sugestoes(movs: &[Value], fixas: &[Value], mes_atual: &str, ignoradas: &[String], categorias: &[Value]) -> Vec<Sugestao>` — mesma regra de `sugestoes` em `frontend/src/fixas.ts:98` (forma e categoria não são necessárias no servidor).

- [ ] **Step 1: Escrever `frontend/testes/casos/fixas.json`** com três listas: `lugar` (`[{ "entrada": "NETFLIX.COM 02/12", "saida": "NETFLIX COM" }, …]` ≥ 6 casos incluindo parcela, asterisco e só números), `nome_limpo` (≥ 4, incluindo `"DL GOOGLE YOUTUB" → "Youtub"`, `"EBN SPOTIFY" → "Spotify"`) e `sugestoes` (≥ 5 cenários `{ movs, fixas, mes_atual, ignoradas, categorias, chaves_esperadas }`: assinatura por categoria; repetida 3 de 4 meses com ≤10% de variação; parou de cobrar (fora); ignorada; já cadastrada pela `busca`; parcela não entra). Gere as saídas esperadas rodando as funções atuais do front, não à mão.
- [ ] **Step 2: Escrever `frontend/testes/fixas.teste.ts`** que importa o JSON e confere `lugar`, `nomeLimpo` e `sugestoes(...).map(s => s.chave)` contra cada caso (mesmo estilo de asserção dos outros `*.teste.ts`). Rodar `cd frontend && npm run teste` → PASS (é o front atual, serve de gabarito).
- [ ] **Step 3: Escrever os testes Rust** em `fixas.rs` (`#[cfg(test)]`): `const CASOS: &str = include_str!("../../frontend/testes/casos/fixas.json");` e três testes `lugar_igual_ao_front`, `nome_limpo_igual_ao_front`, `sugestoes_iguais_ao_front`; mais `paga_no_mes_por_marcacao_e_por_banco` (fixa com `pagos:["2026-11"]` → true; com `busca:"NETFLIX"` e lançamento `-55.9` competência 2026-11 → true; outro mês → false). Rodar `~/.cargo/bin/cargo test --manifest-path backend/Cargo.toml fixas` → FAIL (funções não existem).
- [ ] **Step 4: Implementar as funções** em `fixas.rs` com a mesma normalização do front (`norm`: sem acentos, maiúsculas, espaços únicos). Regex de `nome_limpo` copiada do front.
- [ ] **Step 5: Rodar** `cargo test fixas` e `npm run teste` → PASS.
- [ ] **Step 6: Commit** `feat(fixas): regras de pagamento e sugestões também no servidor, com casos compartilhados`.

### Task 2: Web Push (cifra RFC 8291 + VAPID RFC 8292 + envio)

**Files:**
- Modify: `backend/Cargo.toml` (`p256 = { version = "0.13", features = ["ecdh", "ecdsa"] }`, `aes-gcm = "0.10"`, `hkdf = "0.12"`)
- Create: `backend/src/push.rs`
- Modify: `backend/src/main.rs` (`mod push;`)

**Interfaces:**
- Produces:
  - `pub struct Chaves { pub publica: String, pub privada: String }` (base64url sem padding; pública = ponto não comprimido de 65 bytes).
  - `pub fn gerar_chaves() -> Chaves`
  - `pub fn cifrar(p256dh: &str, auth: &str, mensagem: &[u8], sal: [u8; 16], efemera: Option<&p256::SecretKey>) -> anyhow::Result<Vec<u8>>` — corpo aes128gcm completo (cabeçalho + registro único). `efemera` só para teste.
  - `pub fn jwt_vapid(chaves: &Chaves, endpoint: &str, assunto: &str, agora_unix: i64) -> anyhow::Result<String>` — ES256, `aud` = origem do endpoint, `exp` = agora + 12 h, `sub` = assunto.
  - `pub enum Entrega { Entregue, Expirado, Falhou(String) }`
  - `pub async fn enviar(http: &reqwest::Client, chaves: &Chaves, assunto: &str, endpoint: &str, p256dh: &str, auth: &str, json: &serde_json::Value) -> Entrega` — POST com `Content-Encoding: aes128gcm`, `TTL: 86400`, `Urgency: normal`, `Authorization: vapid t=<jwt>, k=<publica>`; 201/200/202 → Entregue; 404/410 → Expirado; resto ou erro de rede → Falhou.

- [ ] **Step 1: Teste `cifra_bate_com_rfc8291`** usando o exemplo do Apêndice A da RFC 8291 (chaves do agente, `auth`, sal, chave efêmera do servidor e mensagem "When I grow up, I want to be a watermelon"): `assert_eq!(b64url(cifrar(...)?), "<corpo esperado da RFC>")`. Teste `jwt_vapid_verifica`: gera chaves, monta o JWT, confere que tem 3 partes, que o cabeçalho é `{"typ":"JWT","alg":"ES256"}` e que a assinatura verifica com a pública (`p256::ecdsa::VerifyingKey`). Teste `gerar_chaves_tamanhos`: pública decodifica em 65 bytes começando com `0x04`, privada em 32.
- [ ] **Step 2: Rodar** `cargo test push` → FAIL.
- [ ] **Step 3: Implementar** `push.rs` (HKDF-SHA256 conforme RFC 8291 §3.3–3.4; registro com delimitador `0x02`; `rs` = 4096). `enviar` não loga endpoint nem conteúdo, só o resultado.
- [ ] **Step 4: Rodar** `cargo test push` → PASS; `cargo build --release` sem aviso novo.
- [ ] **Step 5: Commit** `feat(push): cifra Web Push e VAPID próprios`.

### Task 3: Regras dos avisos (função pura `verificar`)

**Files:**
- Create: `backend/src/avisos.rs`
- Modify: `backend/src/main.rs` (`mod avisos;`)

**Interfaces:**
- Consumes: `fixas::{paga_no_mes, sugestoes, competencia}` (Task 1).
- Produces:
  - `pub struct Aviso { pub chave: String, pub tipo: &'static str, pub titulo: String, pub texto: String, pub link: String }` — `tipo` ∈ `"fixa_vencendo" | "assinatura_nova" | "fatura" | "fechamento_mes"`.
  - `pub struct Entrada<'a> { pub fixas: &'a Value, pub movs: &'a Value, pub categorias: &'a Value, pub sincronizacoes: &'a Value, pub avisos: &'a Value }` (arquivos lidos do armazenamento).
  - `pub struct Resultado { pub enviar: Vec<Aviso>, pub semente: Vec<String>, pub cartoes: Value }` — `semente` = chaves a gravar em `enviados` sem enviar; `cartoes` = novo `avisos.cartoes`.
  - `pub fn verificar(e: &Entrada, hoje: NaiveDate) -> Resultado`
  - `pub fn ultimo_dia(ano: i32, mes: u32) -> u32`

Regras (do spec, tabela "Verificação"):
- **Primeira verificação** = `avisos.enviados` ausente: tudo que seria enviado hoje vira `semente`, `enviar` vazio.
- `fixa_vencendo`: fixa ativa com `dia`; vencimento = `min(dia, ultimo_dia)` do mês de **amanhã**; dispara se vencimento == amanhã e `!paga_no_mes(f, movs, mes_de_amanhã)`. Chave `fixa:<id>:<AAAA-MM do vencimento>`. Várias no mesmo dia → um aviso só: título `"Contas vencem amanhã"`, texto `"Netflix, Luz e Internet: R$ 312,00"`; uma só → título `"Netflix vence amanhã"`, texto `"R$ 55,90"`. Link `#fixas`. Cada chave individual vai para `enviados`.
- `assinatura_nova`: cada `sugestoes(...)` cuja chave `assinatura:<chave>` não está em `enviados`; agrupar como acima ("Cobranças que parecem assinatura": "Spotify (R$ 21,90) e Deezer (R$ 19,90)"). Link `#fixas`.
- `fatura` (fechou): pela última execução **ok** de `sincronizacoes.execucoes`, contas `tipo == "cartao"` com `fechamento`. `avisos.cartoes[conta_id].fechamento` = guardado. Data fechada = a guardada se ela ≤ hoje e a nova ≠ guardada; ou a nova se ela ≤ hoje. Só se hoje − fechada ≤ 3 dias. Valor = soma de `-valor` dos lançamentos com `conta_id` do cartão e `competencia` == mês da fatura fechada (o mês de `vencimento`; ver `billForecastDate` em `pluggy.rs:299`), sem `pagamento_fatura_cartao`. Texto `"Fatura do <instituicao> fechou: R$ X. Vence em dd/mm"` (sem valor se ≤ 0). Chave `fatura-fechou:<conta_id>:<data>`. Link `#dividas`.
- `fatura` (vence): `vencimento` − hoje ∈ [0, 2] e nenhum lançamento `categoria == "pagamento_fatura_cartao"` com `data` ≥ data de fechamento e |valor| entre 90% e 110% da fatura. Chave `fatura-vence:<conta_id>:<vencimento>`. Texto `"Fatura do Nubank vence em 2 dias: R$ X"` (`"vence hoje"`, `"vence amanhã"`).
- `fechamento_mes`: sempre que a chave `fechamento:<mês anterior>` não estiver em `enviados`. Título `"Resumo de outubro pronto"`, texto `"Toque para ver quanto sobrou no mês."`, link `#fechamento/2026-10`.
- Tipo desligado em `avisos.tipos` → não envia e **não** grava chave (se religar, avisa o que ainda valer).

- [ ] **Step 1: Testes** (todos com `hoje` fixo): `primeira_vez_so_semente`; `fixa_vence_amanha_nao_paga`; `fixa_paga_nao_avisa`; `fixa_dia_31_em_novembro_vence_dia_30` (hoje 29/11 → avisa); `fixa_dia_1_vespera_no_mes_anterior` (hoje 30/11, chave `fixa:x:2026-12`); `ja_enviada_nao_repete`; `varias_fixas_um_aviso_so`; `assinatura_nova_e_ignorada`; `fatura_fechou_data_mantida`; `fatura_fechou_data_pulou_para_proximo_ciclo` (guardada 10/11, nova 10/12, hoje 11/11 → avisa a de 10/11); `fatura_fechou_ha_5_dias_nao_avisa`; `fatura_vence_sem_pagamento_avisa`; `fatura_vence_paga_nao_avisa`; `fatura_sem_sync_ok_nao_avisa`; `fechamento_mes_no_dia_1`; `tipo_desligado_nao_grava_chave`.
- [ ] **Step 2: Rodar** `cargo test avisos` → FAIL.
- [ ] **Step 3: Implementar** `avisos.rs`.
- [ ] **Step 4: Rodar** `cargo test` (tudo) → PASS.
- [ ] **Step 5: Commit** `feat(avisos): regras de quando avisar`.

### Task 4: Arquivo `avisos`, rotas e envio depois da sincronização

**Files:**
- Modify: `backend/src/armazenamento.rs` (`ARQUIVOS` ganha `("avisos", "Avisos no celular", "aparelhos")`; tamanho 13)
- Modify: `backend/src/main.rs` (rotas, gancho em `sincronizar`, bloqueio de `avisos` em `GET /api/dados/:arquivo` e nas fontes)
- Modify: `backend/src/avisos.rs` (funções de arquivo e envio)

**Interfaces:**
- Consumes: `push::{Chaves, gerar_chaves, enviar, Entrega}`, `avisos::{verificar, Entrada, Resultado}`.
- Produces (rotas, JSON):
  - `GET /api/avisos` → `{ "chave_publica": "...", "tipos": { "fixa_vencendo": true, ... }, "aparelhos": [{ "id", "nome", "criado_em", "ultimo_envio" }] }` (gera e grava as chaves se faltarem).
  - `POST /api/avisos/aparelhos` corpo `{ "endpoint", "p256dh", "auth", "nome" }` → `{ "id" }`; `id` = 16 primeiros hex do sha256 do endpoint; endpoint precisa ser `https://`.
  - `DELETE /api/avisos/aparelhos/:id` → `{ "ok": true }`
  - `PUT /api/avisos/tipos` corpo `{ "fixa_vencendo": bool, ... }` (só chaves conhecidas) → `tipos`.
  - `POST /api/avisos/teste` → `{ "enviados": n, "removidos": m }` (título "Financeiro", texto "Avisos ligados neste aparelho.", link `#ajustes`).
  - `pub async fn verificar_e_enviar(app: &App, hoje: NaiveDate, agora: &str)` chamada em `sincronizar` depois de `pluggy::registrar` **e** no ramo sem Pluggy antes do 404; sob `app.escrita`; erros só no log.
- Regras do envio: para cada `Aviso`, enviar a todos os aparelhos; `Expirado` remove o aparelho; `Falhou` soma `falhas` (5 seguidas remove); `Entregue` zera `falhas` e grava `ultimo_envio`. As chaves vão para `enviados` mesmo sem aparelho cadastrado (não acumular aviso velho). `enviados` guarda só os últimos 120 dias. Assunto VAPID: `FINANCEIRO_VAPID_ASSUNTO`, senão `mailto:`+`FINANCEIRO_EMAIL`, senão `mailto:financeiro@localhost`.

- [ ] **Step 1: Testes** (unidade, sem rede; extrair a parte que muda o JSON em `fn aplicar_entregas(avisos: &mut Value, resultados: &[(String /*aparelho id*/, Entrega)], agora: &str)` e `fn registrar_chaves(avisos: &mut Value, chaves: &[String], hoje: NaiveDate)`): `expirado_remove_aparelho`, `cinco_falhas_remove`, `entregue_zera_falhas`, `enviados_corta_120_dias`, `dados_avisos_bloqueado` (o handler de `/api/dados/:arquivo` recusa `avisos` com 404) e `id_do_aparelho_estavel`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** `cargo test` → PASS.
- [ ] **Step 5: Teste manual local** com `FINANCEIRO_ENV=/dev/null` e dados de exemplo: `curl` em `GET /api/avisos` gera chave; `POST /api/sincronizar` sem Pluggy devolve 404 e o log mostra a verificação rodando sem erro.
- [ ] **Step 6: Commit** `feat(avisos): aparelhos, rotas e envio depois da sincronização`.

### Task 5: Avisos no app (service worker, Ajustes, sair)

**Files:**
- Modify: `frontend/public/sw.js` (eventos `push` e `notificationclick`)
- Create: `frontend/src/avisos.ts` (permissão, assinatura, conversão base64url)
- Modify: `frontend/src/api.ts` (tipos e chamadas das rotas da Task 4)
- Create: `frontend/src/componentes/Avisos.tsx` (card)
- Modify: `frontend/src/paginas/Enviar.tsx` (inclui o card nos Ajustes)
- Modify: `frontend/src/App.tsx:279` (`sair` desativa avisos deste aparelho antes de sair)
- Test: `frontend/testes/avisos.teste.ts`

**Interfaces:**
- Consumes: rotas da Task 4.
- Produces: `api.avisos()`, `api.registrarAparelho(a)`, `api.removerAparelho(id)`, `api.tiposAvisos(t)`, `api.testarAvisos()`; em `avisos.ts`: `suportado(): boolean`, `ativar(chavePublica: string): Promise<"ativado" | "negado" | "sem_suporte">`, `desativarEste(): Promise<void>`, `nomeDoAparelho(ua: string): string` (ex.: `"Chrome · Android"`), `chaveParaBytes(b64url: string): Uint8Array`.

- [ ] **Step 1: Teste** `frontend/testes/avisos.teste.ts`: `nomeDoAparelho` para UA de Chrome Android, Chrome Windows, Safari iPhone; `chaveParaBytes` de uma chave de 65 bytes devolve 65 bytes com `[0] === 4`. Rodar `npm run teste` → FAIL.
- [ ] **Step 2: Implementar** `avisos.ts`, as chamadas em `api.ts` e o service worker: `push` → `showNotification(titulo, { body: texto, icon: "/icone-192.png" (o ícone do manifest), badge, tag: tipo, data: { link } })`; `notificationclick` → fecha, procura janela do app (`clients.matchAll({ type: "window" })`), `focus()` + `navigate(link)` ou `openWindow("/" + link)`.
- [ ] **Step 3: Card "Avisos no celular"** em Ajustes: botão "Ativar avisos neste aparelho" (ou "Avisos ativos neste aparelho" + "Desativar"); 4 chaves com os nomes "Conta fixa vencendo", "Cobrança que parece assinatura", "Fatura do cartão", "Resumo do mês"; "Enviar aviso de teste" mostrando "Enviado para N aparelho(s)"; lista de aparelhos com "Remover"; texto: "Os avisos chegam depois das atualizações automáticas (8h, 12h, 16h30, 19h e 22h) e mostram valores." Permissão negada: "As notificações estão bloqueadas. No Chrome, toque nos três pontinhos → Configurações → Notificações e libere este site." Sem suporte: "Este navegador não recebe avisos. No celular, instale o app pela tela de início."
- [ ] **Step 4: `sair`** chama `desativarEste()` (ignora erro) antes de `api.sair()`.
- [ ] **Step 5: Rodar** `npm run teste` e `npm run build` → PASS.
- [ ] **Step 6: Commit** `feat(avisos): ativar avisos no app e abrir a tela certa ao tocar`.

### Task 6: Tela "Fechamento do mês"

**Files:**
- Create: `frontend/src/fechamento.ts` (cálculo puro)
- Create: `frontend/src/paginas/Fechamento.tsx`
- Modify: `frontend/src/navegacao.ts` (tela `"fechamento"` em `Tela`/`TELAS`, aba do celular = `"mais"`, fora dos menus)
- Modify: `frontend/src/App.tsx` (renderiza a tela; aviso no Início do dia 1 ao 7)
- Modify: `frontend/src/paginas/Analises.tsx` (card "Fechamento do mês" com link)
- Modify: `frontend/src/estilo.css` (`@media print`)
- Test: `frontend/testes/fechamento.teste.ts`

**Interfaces:**
- Consumes: `totaisDoMes`, `acimaDaMedia`, `dividasPagasNoMes` (exportar) de `analises.ts`; `resumoReserva` de `reserva.ts`; `situacao` de `fixas.ts`.
- Produces: `export interface ResumoMes { mes: string; entrou: number; saiu: number; sobra: number; cresceram: { nome: string; valor: number; diferenca: number }[]; dividas: number; guardado: number; fixas: { pagas: number; total: number; faltaram: { nome: string; valor: number }[] }; vazio: boolean }` e `export function resumoDoMes(b: Brutos, mes: string): ResumoMes`; `export function mesDoFechamento(detalhe: string | null, hoje: string): string` (detalhe válido e < mês de hoje → ele; senão o mês anterior).

Regras: `cresceram` = top 3 de gasto por grupo no `mes` contra o **mês anterior** (não a média), só diferença > 0; `dividas` = `dividasPagasNoMes(mes)`; `guardado` = `guardou` do mês em `resumoReserva` (contas com `papel: "reserva"`); `fixas` = fixas ativas com `situacao(f, movs, mes, 32)` (`"paga"` conta como paga; resto entra em `faltaram`); `vazio` = nenhum lançamento no mês.

- [ ] **Step 1: Testes** `fechamento.teste.ts`: `resumoDoMes` com movimentos de dois meses (entrou/saiu/sobra; top 3 em ordem; categoria que caiu fica fora); mês sem lançamentos → `vazio: true` e zeros; fixa paga pelo banco e fixa não paga; `mesDoFechamento(null, "2026-11-19") === "2026-10"`, `mesDoFechamento("2026-11", "2026-11-19") === "2026-10"` (mês atual não vale), `mesDoFechamento("lixo", …) === "2026-10"`, `mesDoFechamento("2026-08", …) === "2026-08"`. Rodar → FAIL.
- [ ] **Step 2: Implementar** `fechamento.ts`. Rodar → PASS.
- [ ] **Step 3: Tela** seguindo o esboço do spec: título "Fechamento de outubro/2026", setas para mês anterior/próximo (próximo desabilitado no mês anterior ao atual), frase "Sobrou R$ X — o mês fechou no azul." / "Faltou R$ X — o mês fechou no vermelho.", blocos Entrou/Saiu, "O que mais cresceu (vs. setembro)", Dívidas, Objetivos ("guardados na reserva"), Contas fixas ("9 de 10 pagas · faltou: Academia (R$ 99,90)"), botão "Baixar PDF" (`window.print()`). Mês vazio: "Nada lançado em outubro/2026." Valores respeitam o "esconder valores" atual. Card em Análises e, no Início, do dia 1 ao 7: "O resumo de outubro está pronto" com link.
- [ ] **Step 4: CSS de impressão**: esconde cabeçalho, menus, barra do celular e botões; fundo branco; só o conteúdo da tela.
- [ ] **Step 5: Rodar** `npm run teste` e `npm run build` → PASS. Conferir no navegador local (dados de exemplo + um backup de teste) a tela e a prévia de impressão.
- [ ] **Step 6: Commit** `feat: tela Fechamento do mês com PDF`.

### Task 7: Documentação

**Files:**
- Modify: `README.md` (seção "Usar o sistema": avisos e fechamento; como ativar no Android/iPhone)
- Modify: `.env.example` (`FINANCEIRO_VAPID_ASSUNTO=` comentado, opcional)
- Modify: `docs/MODELO_DE_DADOS.md` (arquivo `avisos`)

- [ ] **Step 1: Escrever** os trechos (curtos, português, mesmo tom do README).
- [ ] **Step 2: Rodar** `cargo test`, `npm run teste`, `npm run build` → PASS.
- [ ] **Step 3: Commit** `docs: avisos no celular e fechamento do mês`.
