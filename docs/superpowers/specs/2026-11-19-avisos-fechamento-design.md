# Avisos no celular e Fechamento do mês — design

Data: 19/11/2026 · Branch: `v4` · Status: aguardando aprovação

## Por quê

Hoje o sistema só ajuda quando é aberto. O usuário quer que o celular (Android, com o Financeiro instalado como app) **avise sozinho** do que pede ação — conta fixa vencendo, cobrança nova com cara de assinatura, fatura do cartão — e que, no começo de cada mês, exista um **resumo do mês anterior** para olhar e guardar em PDF.

Sucesso: o usuário fica sabendo de vencimentos e cobranças sem abrir o app, e no dia 1 recebe o resumo do mês.

## Objetivos

1. Avisos (notificações do sistema operacional) no aparelho onde o usuário ativar, chegando com o app fechado.
2. Quatro tipos de aviso: conta fixa vencendo, cobrança nova com cara de assinatura, fatura do cartão (fechou / vence em 2 dias sem pagamento) e resumo do mês pronto.
3. Tela "Fechamento do mês" com o resumo de um mês, escolha de meses anteriores e "Baixar PDF".

## Fora do escopo

- E-mail, Telegram, SMS ou qualquer outro canal.
- Horário exato de envio (os avisos saem nas sincronizações agendadas).
- iPhone: funciona se o app estiver instalado na tela de início (iOS 16.4+), mas não é alvo de teste agora.
- Avisos de limite por categoria (melhoria separada, não pedida).

## Anti-objetivos (seria fracasso mesmo funcionando)

- Repetir o mesmo aviso a cada sincronização (5 por dia) — vira barulho e o usuário desliga.
- Conteúdo dos avisos passando legível por um serviço de terceiros.
- Exigir configuração nova obrigatória para quem só roda o sistema no computador ou para quem faz fork (o sistema tem que continuar subindo sem nada novo no `.env`).

## Restrições

- O servidor (Render free) dorme; não há agendador próprio. Quem acorda o servidor é o GitHub Actions, que chama `POST /api/sincronizar` às 8h, 12h, 16h30, 19h e 22h (Brasília). **Os avisos são verificados ao fim de cada chamada de sincronização**, com ou sem sucesso da Pluggy, e **também quando a Pluggy não está configurada** (hoje a rota devolve 404 logo de cara; passa a rodar a verificação antes de devolver o 404). Dados do cartão vêm sempre da **última sincronização ok**, nunca de uma que falhou.
- Dados: arquivos JSON por nome no armazenamento (pasta ou Postgres, 30 versões). Gravações passam pela trava `app.escrita`.
- Toda escrita da API exige sessão + cabeçalho `x-financeiro: 1`.
- O service worker (`frontend/public/sw.js`) nunca guarda dados de `/api/*`; isso continua.
- Português do Brasil em tudo, datas dd/mm/aaaa, valores R$ 1.234,56.

## Abordagens consideradas

| | Como | Prós | Contras |
|---|---|---|---|
| **A. Web Push padrão (VAPID) enviado pelo próprio servidor** — escolhida | Servidor gera par de chaves VAPID, o navegador assina (`PushManager.subscribe`), o servidor cifra a mensagem (RFC 8291, aes128gcm) e envia ao endpoint do navegador (FCM no Chrome/Android) | Sem conta em serviço novo, sem custo; conteúdo cifrado ponta a ponta (o Google só entrega); avisos chegam no próprio app | Mais código no servidor (criptografia do Web Push) |
| B. Firebase Cloud Messaging / OneSignal | SDK do serviço no app | Menos código | Conta nova; o serviço vê o conteúdo (valores e nomes) |
| C. App ntfy | Servidor publica num tópico | Muito simples | Aviso em outro app; tópico em servidor de terceiros, legível por quem souber o nome |

O usuário escolheu **A**.

PDF do fechamento: **impressão do navegador** ("Salvar como PDF") com CSS de impressão, em vez de gerar PDF no servidor — mantém a cara do sistema e não adiciona dependência.

## Decisões do usuário

- Celular: Android, app já instalado.
- Caminho A (Web Push próprio).
- **Os avisos mostram o valor** (ex.: "Fatura do Nubank fechou: R$ 1.842,30"). O botão "esconder valores" da tela não se aplica aos avisos.

## Design

### 1. Avisos — servidor

**Novo arquivo de dados `avisos`** (`avisos.json` / linha no Postgres), formato:

```json
{
  "schema_version": 1,
  "chaves": { "publica": "<base64url>", "privada": "<base64url>" },
  "aparelhos": [
    { "id": "<hash do endpoint>", "endpoint": "https://fcm.googleapis.com/...", "p256dh": "...", "auth": "...",
      "nome": "Chrome · Android", "criado_em": "...", "ultimo_envio": "...", "falhas": 0 }
  ],
  "tipos": { "fixa_vencendo": true, "assinatura_nova": true, "fatura": true, "fechamento_mes": true },
  "enviados": [ { "chave": "fixa:<id>:2026-11", "em": "..." } ]
}
```

- **Chaves VAPID** (decisão minha): geradas automaticamente na primeira vez que alguém pede a chave pública e guardadas nesse arquivo. Nenhuma variável nova no `.env`. Opcional `FINANCEIRO_VAPID_ASSUNTO` (contato `mailto:` exigido pelo VAPID); padrão `mailto:` + `FINANCEIRO_EMAIL`, senão um valor genérico. (Guardar a chave privada junto dos dados é aceitável: quem lê o banco já lê tudo.)
- **`enviados`** é o que impede repetição: cada aviso tem uma chave única; se a chave já está lá, não envia de novo. Guarda só os últimos ~120 dias.

**Rotas novas** (todas com login; escritas com `x-financeiro: 1`):

| Rota | Faz |
|---|---|
| `GET /api/avisos` | chave pública VAPID, tipos ligados/desligados, lista de aparelhos (nome, criado_em, ultimo_envio; nunca o endpoint inteiro) |
| `POST /api/avisos/aparelhos` | grava a assinatura deste aparelho (endpoint + chaves); mesma assinatura = atualiza |
| `DELETE /api/avisos/aparelhos/:id` | remove um aparelho |
| `PUT /api/avisos/tipos` | liga/desliga cada tipo |
| `POST /api/avisos/teste` | envia "Avisos ligados neste aparelho" para todos os aparelhos e devolve quantos receberam |

**Envio Web Push** (`backend/src/avisos/push.rs` ou similar): implementação própria com crates RustCrypto (`p256` para ECDH e ECDSA/ES256 do JWT VAPID, `aes-gcm`, `hkdf`), reaproveitando `sha2`, `base64` e `reqwest` já existentes. Cifra aes128gcm (RFC 8291), cabeçalho `Authorization: vapid t=<jwt>, k=<chave pública>` (RFC 8292), `TTL` de 24 h, `Urgency: normal`. Resposta 404/410 → apaga o aparelho; outros erros → `falhas += 1` (apaga com 5 falhas seguidas). (A escolha de usar crate pronta de web-push em vez de implementar fica com o construtor, desde que não traga cliente HTTP novo nem OpenSSL.)

**Conteúdo do aviso** (JSON cifrado lido pelo service worker): `{ "titulo", "texto", "link" }`, onde `link` é a tela a abrir (`#fixas`, `#fechamento?mes=2026-10`…). Valores aparecem no texto.

**Verificação** — função pura `verificar(dados, hoje, agora) -> Vec<Aviso>` (testável sem rede), chamada ao fim de `sincronizar` (depois de registrar a execução). Para cada aviso cuja chave não está em `enviados` e cujo tipo está ligado: envia e registra. Regras:

| Tipo | Quando | Chave | Texto (exemplo) | Abre |
|---|---|---|---|---|
| `fixa_vencendo` | Conta fixa **ativa**, com `dia`, cujo vencimento neste mês é **amanhã** (dia 31 em mês de 30 dias = último dia do mês), **não paga** no mês (marcada em `pagos` ou achada no banco pela `busca`, mesma regra de `frontend/src/fixas.ts::situacao`) | `fixa:<id>:<AAAA-MM>` | "Netflix vence amanhã: R$ 55,90" | `#fixas` |
| `assinatura_nova` | Aparece uma sugestão de conta fixa que não existia antes (mesma regra de `frontend/src/fixas.ts::sugestoes`: só mês atual/anterior, respeitando `ignoradas`) | `assinatura:<chave da sugestão>` | "Cobrança que parece assinatura: Spotify, R$ 21,90. Toque para adicionar às contas fixas" | `#fixas` |
| `fatura` (fechou) | Uma data de fechamento do cartão **já passou** (≤ hoje, no máximo 3 dias atrás) e ainda não foi avisada. Para funcionar tanto se a Pluggy mantiver a data no dia quanto se pular logo para o ciclo seguinte, `avisos` guarda por cartão a **última data de fechamento vista** (`cartoes: { <conta_id>: { fechamento, vencimento } }`): quando a data nova difere da guardada e a guardada já chegou, a guardada é a que fechou | `fatura-fechou:<conta_id>:<data fechamento>` | "Fatura do Nubank fechou: R$ 1.842,30. Vence em 25/11" | `#dividas` |
| `fatura` (vence) | Vencimento do cartão em **2 dias ou menos** (e ainda não passou) e **sem pagamento de fatura** desde o fechamento (lançamento de pagamento de fatura na conta, como já identificado na sincronização) | `fatura-vence:<conta_id>:<data vencimento>` | "Fatura do Nubank vence em 2 dias: R$ 1.842,30" | `#dividas` |
| `fechamento_mes` | A partir do dia 1 (primeira sincronização do mês) | `fechamento:<AAAA-MM do mês anterior>` | "Seu resumo de outubro está pronto. Toque para ver quanto sobrou" (sem valor: decisão minha, ver abaixo) | `#fechamento?mes=AAAA-MM` |

- Valor da fatura fechada (decisão minha): soma dos lançamentos desse cartão cuja competência (`billForecastDate`, já gravada como competência) é o mês da fatura que fechou, a mesma conta que a tela de Dívidas/Análises usa para a fatura. Não usar o `balance` da Pluggy, cujo significado logo depois do fechamento é incerto. Se der zero ou não houver lançamentos, o texto sai sem valor.
- "Sem pagamento" (decisão minha): conta como paga se houver, depois da data de fechamento, um lançamento de pagamento de fatura (natureza `transferencia_interna`, categoria `pagamento_fatura_cartao`, já marcado na sincronização) com valor entre 90% e 110% do valor da fatura. Com vários cartões isso evita confundir uma fatura com outra; se não achar, avisa (avisar a mais é melhor que deixar passar).
- Para `fixa_vencendo` e `assinatura_nova`, as regras de pagamento (`situacao`/`pagamentoNoBanco`) e de sugestões (`sugestoes`, que depende de `lugar`, `compDe`, `nomeLimpo`, do grupo de assinaturas antes/depois da migração de categorias e do tipo de cada conta) hoje só existem no front. **O servidor ganha a versão Rust delas.** Para não divergirem (decisão minha): os casos de teste ficam num arquivo JSON compartilhado (ex.: `docs/casos/fixas.json` ou `frontend/src/__casos__/`) que tanto `cargo test` quanto `npm run teste` leem e conferem. A chave do aviso de assinatura é a mesma chave de sugestão que o front usa (para `ignoradas` continuar funcionando).
- O aviso de resumo do mês **não traz valor** (decisão minha): calcular a sobra no servidor exigiria portar também `totaisDoMes`/holerite, e o servidor já tem uma conta diferente (`calculos::fluxo_do_mes`); um número no aviso diferente do da tela seria pior do que nenhum. Os demais avisos mostram valor, como o usuário pediu.
- Na primeira verificação depois de publicar, as sugestões já existentes **não** devem disparar avisos em massa: na primeira execução, as sugestões atuais entram em `enviados` sem envio (semente).
- No máximo 1 aviso por tipo por aparelho por verificação; se houver vários (ex.: 3 contas vencendo amanhã), juntar num só: "3 contas vencem amanhã: Netflix, Luz, Internet — R$ 312,00".
- Erro de envio nunca faz a sincronização falhar; vai para o log e para `falhas`.

### 2. Avisos — app

- **Service worker**: novo `push` → `showNotification(titulo, { body: texto, icon, badge, data: { link }, tag: tipo })`; novo `notificationclick` → foca uma janela aberta do app e navega para `link`, ou abre uma nova.
- **Ajustes → card "Avisos no celular"**:
  - Botão "Ativar avisos neste aparelho" → pede permissão → `subscribe` com a chave pública → `POST /api/avisos/aparelhos`. Se a permissão estiver negada, explicar como liberar nas configurações do Chrome.
  - Chave liga/desliga para cada tipo (4).
  - "Enviar aviso de teste".
  - Lista de aparelhos ativos com "Remover".
  - Texto curto dizendo que os avisos chegam depois das atualizações automáticas (8h, 12h, 16h30, 19h e 22h) e mostram valores.
- **Sair** remove a assinatura deste aparelho (`unsubscribe` + `DELETE`), para um aparelho deslogado não continuar recebendo valores.

### 3. Fechamento do mês — tela

Nova tela `#fechamento` (aceita `?mes=AAAA-MM`; padrão = mês anterior), calculada no front a partir dos dados que o app já carrega, reaproveitando `frontend/src/analises.ts` (`fechamento`, `totaisDoMes`, `acimaDaMedia`) e `frontend/src/fixas.ts`:

```
Fechamento de outubro/2026                  [< setembro]  [novembro >]
Sobrou R$ 312,40 — o mês fechou no azul.

Entrou   R$ 6.120,00      Saiu   R$ 5.807,60

O que mais cresceu (vs. setembro)
  Mercado        R$ 1.140,00   +R$ 220,00
  Transporte     R$   480,00   +R$ 130,00
  Lazer          R$   350,00   +R$  90,00

Dívidas          R$ 1.230,00 pagos
Objetivos        R$   200,00 guardados

Contas fixas     9 de 10 pagas · faltou: Academia (R$ 99,90)

                                   [Baixar PDF]
```

- "Mês que ainda não terminou" não é escolhível (navegação vai até o mês anterior).
- Ponto de entrada: card em **Análises** ("Fechamento do mês") e, do dia 1 ao 7, um aviso no **Início** ("O resumo de outubro está pronto").
- **Baixar PDF** = `window.print()` com CSS `@media print`: só o conteúdo do fechamento, fundo branco, sem menus, título com o mês. O "esconder valores" é respeitado (se estiver ligado, o PDF sai com os valores escondidos), para não vazar sem querer. (Decisão minha.)

## Fica com o construtor

- Organização dos módulos Rust e componentes React; nomes de funções.
- Crate pronta de web-push vs. implementação própria (com a restrição acima).
- Ícone/badge da notificação (usar os ícones do PWA).
- Exatamente quais números de "Dívidas" e "Objetivos" usar no fechamento, reaproveitando o que Início/Análises já calculam (pagamentos ligados a dívidas no mês; valores guardados em objetivos no mês).
- Testes: regras de `verificar` (cada tipo, repetição, semente, agrupamento, virada de mês, dia 31), cifra do Web Push contra os vetores de teste da RFC 8291, rotas com login exigido, tela de fechamento (cálculos em teste `npm run teste`).
- Documentar no README (seção Usar o sistema) e no `.env.example` (`FINANCEIRO_VAPID_ASSUNTO` opcional).
