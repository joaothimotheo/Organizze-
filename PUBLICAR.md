# Como ter o seu próprio Financeiro online

Este guia monta uma cópia do sistema só sua, de graça: o site no **Render**, os dados num Postgres do **Neon**, login com o **Google** e as contas do banco lidas automaticamente pela **Pluggy** (Open Finance, conector MeuPluggy).

O sistema é de **uma pessoa só**: cada instalação aceita um único e-mail do Google e lê as contas de um único titular. Para outra pessoa usar, ela monta a própria instalação seguindo este guia. Ninguém compartilha banco de dados, chaves ou conexões.

Tempo: cerca de 1 hora, a maior parte esperando a primeira compilação.

## Como as peças se encaixam

```
 seus bancos ──> meu.pluggy.ai ──> aplicação no dashboard.pluggy.ai
 (Santander,      (você conecta      (o sistema lê daqui, só leitura,
  Mercado Pago…)   cada banco)        com Client ID/Secret + id da conexão)
                                              │
                                              ▼
 GitHub (código) ──git push──> Render (site + API, Docker) <──> Neon (Postgres)
        │                              ▲
        └── GitHub Actions, todo dia 19h: POST /api/sincronizar (com token)
```

- **GitHub** guarda o código. Cada `git push` na branch `main` publica uma versão nova no Render.
- **Render** compila o `Dockerfile` (front em React e API em Rust numa imagem só) e serve o site. No plano grátis ele dorme depois de 15 minutos sem acesso; o primeiro acesso depois disso leva cerca de 1 minuto.
- **Neon** guarda todos os dados (o disco do Render é apagado a cada publicação). As tabelas são criadas sozinhas na primeira vez.
- **Pluggy** entrega as transações da conta e do cartão. O sistema só lê: nunca movimenta dinheiro.
- **GitHub Actions** acorda o serviço uma vez por dia e pede a sincronização (o Cron do Render é pago).

## O que você precisa

| Conta | Para quê | Custo |
|---|---|---|
| GitHub | Código e agendamento diário | Grátis |
| Neon (neon.com) | Banco de dados | Grátis (0,5 GB) |
| Render (render.com) | Hospedagem | Grátis (750 h/mês) |
| Google Cloud | Login com Google | Grátis |
| meu.pluggy.ai | Conectar os seus bancos | Grátis para uso pessoal |
| dashboard.pluggy.ai | Aplicação que o sistema usa para ler os dados | Veja o aviso sobre o trial no passo 5 |

Confira as condições na hora de criar: os planos grátis mudam.

## 1. Código no GitHub

1. Peça acesso ao repositório (ou receba uma cópia) e crie um repositório **privado** seu com esse código.
2. No `render.yaml`, troque `name: financeiro` por um nome seu (o endereço vira `https://<name>.onrender.com`). Se for usar o site separado da seção 8, troque também `name: financeiro-site` e o `VITE_API_URL` pelo seu domínio; se não for, pode apagar esse segundo serviço do arquivo.
3. Nunca versione dados: `dados/`, PDFs, OFX, CSV e `.env` já estão no `.gitignore`.

## 2. Banco no Neon

1. Em https://neon.com, crie um projeto na região **AWS US East (N. Virginia)**, a mesma do Render.
2. Em **Connect**, **desligue** "Connection pooling" e copie a connection string (`postgresql://…?sslmode=require`).
3. Ela é a senha do banco: guarde num lugar seguro e não coloque no Git.

## 3. Site no Render

1. Em https://render.com, entre com o GitHub e autorize o acesso ao repositório.
2. **New → Blueprint** e escolha o repositório. O Render lê o `render.yaml` e propõe um serviço Free, Docker, na Virginia.
3. Preencha por enquanto só:

| Variável | O que colocar |
|---|---|
| `DATABASE_URL` | A connection string do Neon |
| `FINANCEIRO_USUARIO` | Um nome de usuário (login de emergência) |
| `FINANCEIRO_SENHA` | Uma senha **nova**, com 10 caracteres ou mais |

As outras pode deixar em branco; você preenche nos próximos passos. `FINANCEIRO_SEGREDO` o próprio Render gera.

4. **Apply**. A primeira compilação do Rust leva de 10 a 30 minutos. Quando terminar, o endereço aparece no topo do serviço. Abra e entre com o usuário e a senha para conferir que está no ar.

## 4. Login com Google

1. Em https://console.cloud.google.com, crie um projeto.
2. **APIs e serviços → Tela de permissão OAuth** (ou "Google Auth Platform"): tipo **Externo**, deixe em **Teste** e adicione o seu e-mail em **Usuários de teste**. Não precisa publicar: o sistema só pede `openid` e `email`.
3. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**. Em **URIs de redirecionamento autorizados**, adicione:
   - `https://SEU-SERVICO.onrender.com/api/auth/google/retorno`
   - `http://127.0.0.1:8080/api/auth/google/retorno` (para testar no computador)
4. No Render, em **Environment**, preencha:

| Variável | O que colocar |
|---|---|
| `GOOGLE_CLIENT_ID` | O ID do cliente (termina em `.apps.googleusercontent.com`) |
| `GOOGLE_CLIENT_SECRET` | A chave secreta do cliente |
| `FINANCEIRO_EMAIL` | O seu e-mail do Google, o único que vai poder entrar |

Salve: o Render publica de novo sozinho. A partir daí aparece **Entrar com Google**. A senha continua valendo como acesso de emergência; para desligá-la, apague `FINANCEIRO_USUARIO` e `FINANCEIRO_SENHA`.

Com domínio próprio, defina também `FINANCEIRO_URL_PUBLICA` (ex.: `https://financeiro.meudominio.com`) e cadastre o retorno com esse endereço.

## 5. Ligar as contas do banco (Pluggy)

São dois sites diferentes, e é aqui que mais se confunde:

- **meu.pluggy.ai** é o seu "cofre": é onde você conecta os bancos.
- **dashboard.pluggy.ai** é o painel de desenvolvedor: é onde fica a aplicação que o sistema usa para ler esses dados.

O sistema precisa do id que aparece no **dashboard**, nunca do que aparece na URL do meu.pluggy.ai.

### 5.1 Conectar os bancos no meu.pluggy.ai

1. Entre em https://meu.pluggy.ai → **Conexões** → conectar uma conta.
2. Escolha o banco e autorize no app do banco (Open Finance). O consentimento vale até 12 meses.
3. Repita para cada banco (até 5 conexões do mesmo titular). Espere cada uma aparecer na lista com transações.

### 5.2 Criar a aplicação no dashboard

1. Em https://dashboard.pluggy.ai → **Aplicações**, crie uma aplicação (ex.: "Financeiro").
2. Copie o **Client ID** e o **Client Secret**. O Secret não vai para o Git nem para conversas.

### 5.3 Trazer cada banco para a aplicação

Faça isto **uma vez para cada banco**:

1. Na aplicação, abra a tela de teste (ícone de play / **Demo**) e clique em **Conectar Conta**.
2. Escolha o conector **MeuPluggy** e entre com a sua conta do meu.pluggy.ai.
3. Marque **só o banco desta vez** (ex.: só o Santander) e autorize logo, porque a tela expira.
4. Em **Itens Conectados** aparece um item "MeuPluggy" com status **Atualizado**. Clique nele e confira na aba **Contas** se o banco certo está lá.
5. Copie o id que aparece **em cima do nome do item** (formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

Um banco por item evita que o mesmo banco entre duas vezes e duplique os lançamentos.

### 5.4 Configurar no Render

| Variável | O que colocar |
|---|---|
| `PLUGGY_CLIENT_ID` | Client ID da aplicação |
| `PLUGGY_CLIENT_SECRET` | Client Secret da aplicação |
| `PLUGGY_ITEM_ID` | Os ids dos itens, separados por vírgula: `id-do-banco-1,id-do-banco-2` |
| `FINANCEIRO_TOKEN_SYNC` | Um texto aleatório de 32+ caracteres. Gere com `openssl rand -hex 32` |

Depois de publicar, a faixa de cima do site mostra "sincronizar agora". A primeira sincronização traz até 12 meses. Se faltar histórico, use **Ajustes → Histórico do banco → Buscar os últimos 12 meses**.

### 5.5 Conta de reserva

Uma conta marcada como **Reserva** aparece à parte na Visão geral: fica fora do "saldo na conta", mas entra no patrimônio, e a meta de reserva de emergência acompanha o saldo dela. Contas do Mercado Pago já entram como Reserva; para mudar qualquer conta, use **Ajustes → Suas contas → Dia a dia | Reserva**. Transferências entre as suas próprias contas são reconhecidas e não contam como entrada nem como gasto.

### 5.6 Acrescentar um banco depois

1. Conecte o banco no meu.pluggy.ai.
2. Repita o passo 5.3 marcando só o banco novo.
3. Acrescente o id novo no fim de `PLUGGY_ITEM_ID`, depois de uma vírgula.

**Não apague nem troque os itens que já estão funcionando**: um item novo gera ids novos para as transações, e o mesmo histórico entraria de novo.

### 5.7 Testar antes de publicar (opcional)

Com `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` e `PLUGGY_ITEM_ID` no `.env` local, rode `python3 scripts/pluggy_teste.py`. Ele só lê e mostra um resumo das contas.

### Aviso sobre o trial do dashboard

O dashboard da Pluggy mostra um período de trial ao criar a aplicação. O MeuPluggy é gratuito para uso pessoal, mas confirme, quando o trial acabar, se a sincronização continua funcionando (a faixa de cima do site mostra erro se a Pluggy recusar).

## 6. Sincronização diária (GitHub Actions)

No repositório, em **Settings → Secrets and variables → Actions → New repository secret**, crie:

| Segredo | Valor |
|---|---|
| `FINANCEIRO_URL` | `https://SEU-SERVICO.onrender.com` |
| `FINANCEIRO_TOKEN_SYNC` | O mesmo valor colocado no Render |

O workflow **Sincronizar banco** (`.github/workflows/sincronizar.yml`) roda cinco vezes por dia (8h, 12h, 16h30, 19h e 22h de Brasília), para pegar a leitura diária do MeuPluggy pouco depois dela. Para testar na hora: **Actions → Sincronizar banco → Run workflow**. O log mostra só contagens, sem valores.

Para chamar à mão (ex.: num script), a requisição precisa dos dois cabeçalhos:

```bash
curl -X POST "https://SEU-SERVICO.onrender.com/api/sincronizar" \
  -H "Authorization: Bearer $FINANCEIRO_TOKEN_SYNC" -H "x-financeiro: 1"
```

## 7. Primeiro uso

1. Entre com o Google.
2. **Ajustes → Lançamentos sem categoria**: classifique o que o sistema não reconheceu. Ele aprende e aplica nas próximas compras iguais.
3. **Ajustes → Categorias**: crie, renomeie ou exclua categorias.
4. **Dívidas**, **Metas** e **Pessoas**: cadastre o que o banco não informa (parcelamentos, empréstimos, dinheiro emprestado a alguém, metas de economia).
5. **Gastos**: veja quanto gastou em cada categoria, mês a mês.
6. No celular, instale como app: Android (Chrome) pelo botão **Instalar app** em **Ajustes**; iPhone (Safari) em **Compartilhar → Adicionar à Tela de Início**. Os dados financeiros não ficam guardados no aparelho.

O envio de extratos, faturas em PDF e holerites continua existindo em **Ajustes → Documentos (legado)**, para quem não quiser usar o Open Finance. A leitura de fatura em PDF só conhece o layout do Santander.

## 8. Domínio próprio com o site separado do servidor (opcional)

No plano grátis, o servidor dorme depois de uns 15 minutos parado e, ao acordar, quem responde é o Render, com a tela de carregamento dele. Separando as telas num **site estático** (grátis e não dorme), o seu site abre na hora com "Estamos carregando seus dados" enquanto o servidor acorda. Exemplo com `app.seudominio.com.br` (telas) e `api.seudominio.com.br` (servidor). Faça **nesta ordem**, para o login não parar no meio:

1. **Site estático no Render.** New > Static Site, o mesmo repositório, com:
   - Build Command: `cd frontend && npm ci && npm run build`
   - Publish Directory: `frontend/dist`
   - Variável `VITE_API_URL` = `https://api.seudominio.com.br`
   - Em Redirects/Rewrites: origem `/*`, destino `/index.html`, ação **Rewrite**.
   (Se você usa o Blueprint, o `render.yaml` já traz esse serviço, o segundo da lista; troque o nome dele por um seu.)
2. **DNS do servidor.** No painel do seu domínio, crie um registro **CNAME** `api` apontando para o endereço `.onrender.com` do serviço web. No Render, em Settings > Custom Domains do serviço web, adicione `api.seudominio.com.br` e espere o certificado ficar verde.
3. **Google.** No Google Cloud, em APIs e serviços > Credenciais > o seu cliente OAuth, acrescente em "URIs de redirecionamento autorizados": `https://api.seudominio.com.br/api/auth/google/retorno` (pode manter os antigos).
4. **Variáveis do serviço web** (Environment): `FINANCEIRO_URL_PUBLICA` = `https://api.seudominio.com.br` e `FINANCEIRO_URL_APP` = `https://app.seudominio.com.br`. Salve e espere o deploy.
5. **Mudar as telas de lugar.** No serviço web, remova o domínio `app.seudominio.com.br`; no site estático, adicione-o. No DNS, troque o CNAME `app` para o endereço `.onrender.com` do site estático.
6. **Testar.** Abra `https://app.seudominio.com.br`, saia e entre com o Google: deve voltar para o `app`. O endereço antigo `.onrender.com` das telas passa a levar para o `app`; a sincronização diária continua funcionando nele.

## 9. Publicar em outro lugar (qualquer serviço com Docker)

O Render e o Neon são só uma opção grátis. O sistema é uma imagem Docker só (`Dockerfile`: front compilado + servidor) e roda em qualquer lugar que aceite Docker: Railway, Fly.io, Koyeb, Google Cloud Run, um VPS seu etc.

**Onde guardar os dados (escolha um):**

- **Postgres** (recomendado): Neon, Supabase, Railway, Aiven ou o seu. Coloque a connection string em `DATABASE_URL` (com TLS, ex.: `?sslmode=require`). As tabelas são criadas sozinhas.
- **Arquivos JSON num disco persistente**: deixe `DATABASE_URL` vazio e aponte `FINANCEIRO_DADOS` para uma pasta num volume que sobreviva às publicações (ex.: `/dados`). Sem volume persistente, os dados somem a cada deploy.

**Variáveis mínimas** (as mesmas da seção 3, no painel do serviço ou num arquivo de ambiente):

| Variável | Valor |
|---|---|
| `DATABASE_URL` ou `FINANCEIRO_DADOS` | Ver acima |
| `FINANCEIRO_USUARIO` e `FINANCEIRO_SENHA`, ou o login com Google (seção 4) | Online o sistema **não sobe sem login** |
| `FINANCEIRO_SEGREDO` | 32+ caracteres aleatórios (`openssl rand -hex 32`) |
| `FINANCEIRO_URL_PUBLICA` | O endereço público, ex.: `https://financeiro.seudominio.com.br` (usado no retorno do Google) |
| `PORT` | Quase todo serviço define sozinho. Se não, use `FINANCEIRO_ENDERECO=0.0.0.0:8080` |
| `PLUGGY_*` e `FINANCEIRO_TOKEN_SYNC` | Seção 5 |

**Exemplo num servidor seu com Docker:**

```bash
docker build -t financeiro .
docker run -d --name financeiro --restart unless-stopped \
  --env-file .env \
  -e FINANCEIRO_ENDERECO=0.0.0.0:8080 \
  -e FINANCEIRO_DADOS=/dados -v financeiro-dados:/dados \
  -p 8080:8080 financeiro
```

Coloque um proxy com HTTPS na frente (Caddy, Nginx, Cloudflare Tunnel): o login usa cookies seguros e o Google exige HTTPS no endereço de retorno. No Google Cloud, cadastre `https://SEU-ENDERECO/api/auth/google/retorno`.

**Sincronização agendada:** nos segredos do GitHub (seção 6), `FINANCEIRO_URL` passa a ser o seu endereço. Ou, no próprio servidor, um `cron` chamando `POST /api/sincronizar` com os cabeçalhos `Authorization: Bearer <FINANCEIRO_TOKEN_SYNC>` e `x-financeiro: 1`.

## Atualizar

Todo `git push` na branch `main` publica sozinho no Render (em outros serviços, depende de como você ligou o repositório). Para receber melhorias de quem passou o código, traga as mudanças para o seu repositório (por exemplo `git pull <repositório-original> main`) e faça `git push`.

## Quando algo não funciona

| O que aparece | Causa | O que fazer |
|---|---|---|
| Carrega por até 1 minuto | Plano grátis dormindo | Normal |
| "O servidor está no ar, mas o sistema não conseguiu iniciar" | Variável faltando ou banco não conectou | A página diz qual. Corrija em **Environment** e salve |
| Deploy "Failed" | Erro de compilação | **Events → Deploy**, últimas linhas do log |
| "No open ports detected" | `PORT` ou `FINANCEIRO_ENDERECO` definidos à mão | Apague as duas do Environment |
| "Esta conta do Google não tem acesso" | E-mail diferente de `FINANCEIRO_EMAIL` | Entre com o e-mail certo |
| Erro `redirect_uri_mismatch` no Google | Endereço de retorno diferente do cadastrado | Cadastre exatamente `https://SEU-SERVICO.onrender.com/api/auth/google/retorno` |
| "ITEM_NOT_FOUND" / "PLUGGY_ITEM_ID não pertence a esta aplicação" | Id do meu.pluggy.ai ou da aplicação no lugar do id do item | Use o id de cima do item em **Itens Conectados** do dashboard (passo 5.3) |
| "requisição sem o cabeçalho do aplicativo" | Chamada à API sem `x-financeiro: 1` | Acrescente o cabeçalho |
| Lançamentos de um banco em dobro | O mesmo banco em dois itens | Deixe cada banco em um item só |
| Aviso de autorização vencendo | Consentimento do Open Finance perto de 12 meses | meu.pluggy.ai → Conexões → autorize de novo |

Apague serviços repetidos no Render (**Settings → Delete Web Service**): eles dividem as mesmas 750 horas grátis.

## Segurança

- Nada é mostrado sem login. Com o Google, só o e-mail de `FINANCEIRO_EMAIL` entra. No login por senha, 5 erros travam o login por 5 minutos.
- Chaves e senhas (`DATABASE_URL`, `GOOGLE_CLIENT_SECRET`, `PLUGGY_CLIENT_SECRET`, `FINANCEIRO_TOKEN_SYNC`, `FINANCEIRO_SENHA`) ficam só no Environment do Render, nos segredos do GitHub e no `.env` local, que não vai para o Git.
- Baixe uma cópia de segurança de vez em quando em **Ajustes → Cópia de segurança**: o Neon grátis não garante backup.

## Rodar no próprio computador

Sem banco e sem login, só aceitando conexões da própria máquina. Veja o [README](README.md).
