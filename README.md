# Financeiro

Sistema de finanças pessoais: o que entrou e saiu da conta e do cartão (lido do banco pelo Open Finance), categorias que você mesmo cria, dívidas com parcelas e juros, contas fixas, empréstimos entre pessoas, objetivos e análises que respondem perguntas como "vou fechar o mês no azul?".

- **Back-end:** Rust ([axum](https://github.com/tokio-rs/axum)). Uma API em `/api/*` que também serve o front compilado.
- **Front-end:** React + TypeScript ([Vite](https://vitejs.dev)), gráficos em Chart.js. Funciona no computador e no celular (instala como app).
- **Dados:** no computador, arquivos JSON na pasta `dados/` (fora do Git). Online, um Postgres (Neon). Formato em [docs/MODELO_DE_DADOS.md](docs/MODELO_DE_DADOS.md).
- **Banco automático:** transações da conta e do cartão chegam pela [Pluggy](https://pluggy.ai) com o conector **MeuPluggy**, grátis para uso pessoal.

> **Cada pessoa usa a sua própria cópia.** O sistema é de uma pessoa só: cada instalação tem o próprio `.env`, a própria conta na Pluggy, os próprios bancos conectados e os próprios dados. Ninguém compartilha chaves, conexões ou banco de dados. Nunca suba o seu `.env` nem a pasta `dados/` para o repositório.

> **Este repositório não está ligado a nenhum sistema publicado.** Para usar, faça um fork (ou baixe) e siga os passos abaixo. Melhorias são bem-vindas por Pull Request.

## Sumário

1. [Rodar no seu computador](#1-rodar-no-seu-computador)
2. [O seu `.env`](#2-o-seu-env)
3. [Conectar o seu banco (Pluggy / MeuPluggy)](#3-conectar-o-seu-banco-pluggy--meupluggy)
4. [Usar o sistema](#4-usar-o-sistema)
5. [Publicar online (opcional)](#5-publicar-online-opcional)
6. [Para quem vai mexer no código](#6-para-quem-vai-mexer-no-código)
7. [Privacidade e segurança](#7-privacidade-e-segurança)

---

## 1. Rodar no seu computador

### Requisitos

- **Git**
- **Rust** 1.80 ou mais novo — instale com [rustup](https://rustup.rs) (`curl https://sh.rustup.rs -sSf | sh`)
- **Node.js** 20 ou mais novo (com npm)
- (Opcional) **Python 3**, só para o script que testa a conexão com a Pluggy

### Baixar

```bash
git clone <endereço do repositório>
cd financeiro
```

### Primeira execução

```bash
# 1. Crie o seu .env (pode deixar tudo vazio por enquanto)
cp .env.example .env

# 2. Compile o front-end
cd frontend && npm install && npm run build && cd ..

# 3. Rode o servidor (ele também serve o front compilado)
cargo run --release --manifest-path backend/Cargo.toml
```

Abra **http://127.0.0.1:8080**.

- A primeira compilação do Rust demora alguns minutos; as seguintes são rápidas.
- Na primeira vez, a pasta `dados/` é criada a partir de `dados-exemplo/` (vazia). É nela que os seus dados vão ficar.
- Sem login configurado, o sistema só aceita acesso da própria máquina (127.0.0.1). Isso é proposital.
- Sem a Pluggy configurada, tudo funciona, mas os lançamentos só entram à mão (botão **+ Lançar**) ou por documento (Ajustes → Documentos (legado)).

### Desenvolvimento (com recarga automática)

Em dois terminais:

```bash
cargo run --manifest-path backend/Cargo.toml   # API em http://127.0.0.1:8080
```

```bash
cd frontend && npm run dev                      # interface em http://localhost:5173
```

Abra **http://localhost:5173**: o Vite repassa `/api` para o servidor da porta 8080.

---

## 2. O seu `.env`

Toda a configuração fica num arquivo `.env` na raiz do repositório. **Cada pessoa tem o seu.** Ele está no `.gitignore` e nunca vai para o Git.

```bash
cp .env.example .env
```

O [`.env.example`](.env.example) explica cada variável. O servidor lê o `.env` sozinho na partida; o que já estiver definido no ambiente (por exemplo, no Render) vale mais que o arquivo. Para usar outro arquivo: `FINANCEIRO_ENV=/caminho/outro.env`.

| Grupo | Variáveis | Precisa? |
|---|---|---|
| Open Finance | `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_ITEM_ID` | Só para ler o banco automaticamente (seção 3) |
| Agendamento | `FINANCEIRO_TOKEN_SYNC` | Só online, para a sincronização agendada |
| Login | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FINANCEIRO_EMAIL`, `FINANCEIRO_USUARIO`, `FINANCEIRO_SENHA`, `FINANCEIRO_SEGREDO` | Opcional no computador; obrigatório online |
| Dados | `DATABASE_URL`, `FINANCEIRO_DADOS` | Vazio = JSON em `dados/` |
| Servidor | `FINANCEIRO_ENDERECO`, `FINANCEIRO_FRONTEND`, `FINANCEIRO_URL_PUBLICA`, `FINANCEIRO_URL_APP` | Só se quiser mudar o padrão |

Depois de mudar o `.env`, pare o servidor (Ctrl+C) e rode de novo.

---

## 3. Conectar o seu banco (Pluggy / MeuPluggy)

O sistema só **lê** transações e saldos. Ele nunca movimenta dinheiro. O caminho é:

```
seus bancos ──> meu.pluggy.ai ──> sua aplicação no dashboard.pluggy.ai ──> este sistema
(app do banco)   (você conecta     (o sistema lê daqui com Client ID,
                  cada banco)        Client Secret e o id de cada item)
```

São duas contas diferentes na Pluggy: o **meu.pluggy.ai** (onde você conecta os seus bancos, como usuário) e o **dashboard.pluggy.ai** (onde você cria uma aplicação, como desenvolvedor). Use o **mesmo e-mail** nas duas.

### 3.1 Conectar os seus bancos no meu.pluggy.ai

1. Crie a sua conta em **https://meu.pluggy.ai**.
2. Vá em **Conexões → Conectar conta**, escolha o banco e autorize no app do banco (Open Finance). O consentimento vale até 12 meses.
3. Repita para cada banco (até 5 conexões do mesmo titular). Espere cada um aparecer com transações.

### 3.2 Criar a sua aplicação no dashboard

1. Crie a sua conta em **https://dashboard.pluggy.ai**.
2. Em **Aplicações**, crie uma aplicação (ex.: "Financeiro").
3. Copie o **Client ID** e o **Client Secret** para o seu `.env`:
   ```
   PLUGGY_CLIENT_ID=...
   PLUGGY_CLIENT_SECRET=...
   ```
   O Client Secret é uma senha: não mande para ninguém nem coloque no Git.

### 3.3 Trazer cada banco para a sua aplicação

Faça isto **uma vez para cada banco**:

1. Na sua aplicação, abra a tela de teste (ícone de play / **Demo**) e clique em **Conectar Conta**.
2. Escolha o conector **MeuPluggy** e entre com a sua conta do meu.pluggy.ai.
3. Marque **só um banco** (ex.: só o Nubank) e autorize logo, porque a tela expira.
4. Em **Itens Conectados** aparece um item "MeuPluggy" com status **Atualizado**. Abra o item e confira na aba **Contas** se é o banco certo.
5. Copie o **id do item** (o texto em cima do nome, no formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

Coloque os ids no `.env`, separados por vírgula:

```
PLUGGY_ITEM_ID=id-do-item-do-banco-1,id-do-item-do-banco-2
```

Cuidados:

- Use o id do **item** que aparece no dashboard. **Não** é o id da aplicação, nem o que aparece na URL do meu.pluggy.ai.
- Um banco por item. Se o mesmo banco estiver em dois itens, os lançamentos entram duplicados.
- Para acrescentar um banco depois: conecte no meu.pluggy.ai, repita o passo 3.3 só com ele e **acrescente** o id no fim da lista. Não apague nem troque os itens que já funcionam (um item novo gera ids novos e o histórico entraria de novo).

### 3.4 Testar a conexão (opcional)

```bash
python3 scripts/pluggy_teste.py
```

Ele lê o `.env`, só consulta (não grava nada) e mostra um resumo das contas de cada item.

### 3.5 Trazer as transações

1. Rode o servidor de novo (para ele ler o `.env`).
2. No sistema, clique no botão de **atualizar** (setas em círculo) na barra do topo.
3. A primeira vez traz os últimos meses. Para buscar até 12 meses: **Ajustes → Histórico do banco → Buscar os últimos 12 meses**.

### Sobre o tempo de atualização

O MeuPluggy lê os seus bancos **uma vez a cada 24 horas**, sozinho. O botão de atualizar só busca o que ele já leu. A barra do topo mostra a hora real dessa leitura ("Dados do banco de ontem às 15:50"), e depois de atualizar o sistema avisa quando é a próxima. Por isso o saldo pode diferir do app do banco em compras e Pix feitos depois da última leitura.

O dashboard da Pluggy mostra um período de trial ao criar a aplicação. O MeuPluggy é gratuito para uso pessoal, mas confira se a sincronização continua funcionando quando o trial acabar (o sistema avisa na barra do topo se a Pluggy recusar).

---

## 4. Usar o sistema

| Tela | Para quê |
|---|---|
| **Início** | Como está o mês: quanto sobrou, para onde foi o dinheiro, de onde veio, próximas contas e reserva |
| **Movimentos** | Todas as entradas e saídas. Busca, filtros, mudar categoria, dividir um lançamento em partes, ligar a uma dívida, pessoa ou conta fixa, e o modo rápido para organizar os pendentes |
| **Dívidas** | Por tipo (cartão parcelado, empréstimos, pessoas, outras): quanto deve, juros que faltam, peso no salário, quando fica livre, simulador de adiantamento e ordem sugerida. Confirma pagamentos achados no banco |
| **Objetivos** | Reserva de emergência, metas e "vou receber um dinheiro" |
| **Análises** | Seis perguntas respondidas em uma frase e um gráfico |
| **Contas fixas, Pessoas, Salários** | Contas do mês, empréstimos entre pessoas, holerites |
| **Categorias** | Os seus grupos de gasto e as origens das entradas. Na primeira vez, a tela de migração cria os grupos a partir das categorias antigas |
| **Ajustes** | Tema, conexão com o banco, cópia de segurança (baixar e restaurar), documentos e sair |

Dicas:

- **+ Lançar** registra um gasto ou entrada à mão (dinheiro vivo, por exemplo).
- O olho na barra do topo esconde todos os valores.
- **Ajustes → Cópia de segurança → Baixar cópia (.json)** guarda todos os seus dados num arquivo. Faça de vez em quando.

---

## 5. Publicar online (opcional)

Cada pessoa publica a própria cópia, onde quiser, com as próprias contas e chaves. O passo a passo completo está em [PUBLICAR.md](PUBLICAR.md):

| Caminho | Custo | Onde ver |
|---|---|---|
| **Render + Neon** (Blueprint pronto no `render.yaml`) + login com Google + Pluggy + sincronização agendada no GitHub Actions | Grátis | PUBLICAR.md, seções 1 a 8 |
| **Qualquer serviço com Docker** (Railway, Fly.io, Cloud Run, VPS…) com Postgres (Neon, Supabase…) ou disco persistente | Depende do serviço | PUBLICAR.md, seção 9 |

O essencial em qualquer lugar:

1. Use um repositório **seu e privado** (fork ou cópia) e, se for o Render, troque os nomes dos serviços no `render.yaml`.
2. Um banco Postgres (`DATABASE_URL`) ou um disco que não se apague a cada publicação (`FINANCEIRO_DADOS`).
3. **Login obrigatório** online: usuário e senha e/ou Google. Sem login, o sistema só aceita acesso local.
4. HTTPS na frente e `FINANCEIRO_URL_PUBLICA` com o endereço público.
5. As chaves da **sua** aplicação Pluggy (seção 3) nas variáveis do serviço, nunca no Git.
6. A sincronização agendada: segredos `FINANCEIRO_URL` e `FINANCEIRO_TOKEN_SYNC` no GitHub (o workflow já está em `.github/workflows/sincronizar.yml`), ou um cron no seu servidor.

---

## 6. Para quem vai mexer no código

### Estrutura

```
backend/src/
  main.rs            rotas da API e handlers
  armazenamento.rs   leitura e gravação dos JSON (pasta ou Postgres), com versões
  auth.rs            login (Google e senha) e sessão
  pluggy.rs          sincronização com a Pluggy
  categorias.rs      grupos, migração das categorias, sugestões
  lancamentos.rs     partes, vínculos e "quem" de um lançamento
  dividas.rs         tipos de dívida e pagamento de parcelas
  calculos.rs        indicadores da visão geral
  importar/          leitura de holerite, fatura e extrato (documentos)
frontend/src/
  App.tsx            esqueleto, rotas (#inicio, #movimentos…) e carga dos dados
  api.ts             tipos e chamadas à API
  *.ts               regras puras e testadas (movimentos, dividas, analises, grupos, navegacao…)
  paginas/           uma tela por arquivo
  componentes/       menu, barra do topo, janelas, gráficos
frontend/testes/     testes das regras (Node)
docs/                modelo de dados, especificação, planos e protótipo da remodelagem
dados-exemplo/       arquivos vazios usados para criar dados/ na primeira vez
```

### Testes

```bash
cargo test --manifest-path backend/Cargo.toml   # servidor
cd frontend && npm run teste                    # regras do front
cd frontend && npm run build                    # checagem de tipos + build
```

As regras de negócio ficam em funções puras (Rust em `backend/src/*.rs`, TypeScript em `frontend/src/*.ts`) com teste ao lado. Telas só desenham.

### Testar com dados de mentira

Para não misturar com os seus dados, aponte para outra pasta:

```bash
cp -R dados-exemplo /tmp/financeiro-teste
FINANCEIRO_DADOS=/tmp/financeiro-teste cargo run --manifest-path backend/Cargo.toml
```

Para rodar sem login e sem Pluggy mesmo tendo o `.env` preenchido: `FINANCEIRO_ENV=/dev/null`.

### Convenções

- **Português do Brasil** em tudo: textos da tela, nomes no código, comentários e mensagens de commit.
- Uma branch por mudança, partindo da `main`; abra um Pull Request descrevendo o que mudou e como testou.
- Mudança maior: escreva antes uma especificação curta e um plano em `docs/superpowers/` (há exemplos lá).
- Toda requisição que grava precisa do cabeçalho `x-financeiro: 1` (o front já envia).

### API (resumo)

| Rota | O que faz |
|---|---|
| `GET /api/saude` | Está no ar? (livre) |
| `GET/POST/DELETE /api/sessao`, `GET /api/auth/google` | Login e sessão |
| `GET /api/visao-geral?ano=2026&mes=11` | Indicadores e séries do período |
| `GET /api/dados/{arquivo}` | Conteúdo de um arquivo de dados (`movimentacoes`, `dividas`…) |
| `POST /api/movimentacoes`, `PATCH/DELETE /api/movimentacoes/{id}` | Lançamento manual; categoria, nome, partes, vínculo, quem |
| `GET/POST /api/categorias`, `…/migracao`, `…/migrar`, `…/sugestoes` | Grupos e migração |
| `POST /api/dividas`, `…/tipos`, `…/{id}/recusar` | Dívidas, tipos e sugestões recusadas |
| `POST /api/fixas`, `POST /api/emprestimos`, `POST /api/metas` | Contas fixas, empréstimos entre pessoas, metas |
| `POST /api/sincronizar`, `GET /api/sincronizacao` | Busca na Pluggy e estado da última busca |
| `GET/POST /api/backup` | Baixa ou restaura a cópia de segurança |

A lista completa está em `backend/src/main.rs` (procure por `.route(`).

---

## 7. Privacidade e segurança

- **Nunca** coloque no Git: `.env`, a pasta `dados/`, cópias de segurança (`financeiro-backup-*.json`), holerites, faturas e extratos. O `.gitignore` já bloqueia `.env`, `dados/`, `documentos/` e arquivos PDF, OFX, CSV e Excel; confira `git status` antes de cada commit.
- Não mande o seu `.env`, Client Secret ou tokens em conversas ou capturas de tela. Se vazar, gere outro no painel correspondente (Pluggy, Google) e troque no `.env`.
- Ao testar a cópia de outra pessoa, use os seus próprios bancos e chaves; nada aqui depende da conta de quem criou o projeto.
