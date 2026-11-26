# Financeiro

Sistema de finanças pessoais que lê sozinho a sua conta e o seu cartão pelo Open Finance e mostra, de um jeito simples, para onde vai o seu dinheiro.

- Entradas e saídas da conta e do cartão chegam automaticamente, algumas vezes por dia.
- Categorias que você mesmo cria, com o sistema aprendendo a classificar as próximas compras.
- Dívidas com parcelas e juros, "quando fico livre", contas fixas, empréstimos entre pessoas, reserva de emergência e objetivos.
- Início com o mês na palma da mão: quanto sobrou, fatura atual do cartão, quanto dá para gastar por dia até o salário e limites de gasto por categoria.
- Funciona no computador e no celular (instala como app) e manda avisos no celular.

> **Cada pessoa monta a sua própria cópia.** O sistema é de uma pessoa só: cada instalação tem as próprias contas (GitHub, Neon, Render, Google, Pluggy), as próprias chaves e os próprios dados. Ninguém vê os dados de ninguém, e quem passou o código para você não tem acesso a nada seu.

---

## Sumário

**Parte 1 — Montar o seu sistema online (passo a passo, sem precisar programar)**

- [Como as peças se encaixam](#como-as-peças-se-encaixam)
- [O que você vai precisar](#o-que-você-vai-precisar)
- [Passo 0. Prepare uma anotação segura](#passo-0-prepare-uma-anotação-segura)
- [Passo 1. GitHub: a sua cópia do código](#passo-1-github-a-sua-cópia-do-código)
- [Passo 2. Neon: o banco de dados](#passo-2-neon-o-banco-de-dados)
- [Passo 3. Gerar as chaves secretas](#passo-3-gerar-as-chaves-secretas)
- [Passo 4. Render: colocar o site no ar](#passo-4-render-colocar-o-site-no-ar)
- [Passo 5. Google: entrar com a sua conta Google](#passo-5-google-entrar-com-a-sua-conta-google)
- [Passo 6. Pluggy: ligar os seus bancos](#passo-6-pluggy-ligar-os-seus-bancos)
- [Passo 7. Sincronização automática (GitHub Actions)](#passo-7-sincronização-automática-github-actions)
- [Passo 8. Primeiro uso](#passo-8-primeiro-uso)

**Parte 2 — Dia a dia**

- [As telas do sistema](#as-telas-do-sistema)
- [Receber as versões novas](#receber-as-versões-novas)
- [Quando algo não funciona](#quando-algo-não-funciona)
- [Privacidade e segurança](#privacidade-e-segurança)

**Parte 3 — Para quem vai mexer no código**

- [Rodar no seu computador](#rodar-no-seu-computador)
- [Estrutura, testes e convenções](#estrutura-testes-e-convenções)

Tópicos avançados (domínio próprio, publicar fora do Render com Docker) estão em [PUBLICAR.md](PUBLICAR.md).

---

# Parte 1 — Montar o seu sistema online

Tempo total: cerca de **1 hora**, boa parte esperando a primeira publicação. Dá para fazer tudo pelo navegador; só o Passo 1 e o Passo 3 usam o terminal por alguns segundos (com alternativa para quem nunca usou).

## Como as peças se encaixam

```
 seus bancos ──> meu.pluggy.ai ──> sua aplicação no dashboard.pluggy.ai
 (Nubank, Itaú,    (você conecta       (o sistema lê daqui, só leitura)
  Inter…)           cada banco)                  │
                                                 ▼
 GitHub (código) ──publica──> Render (site + servidor) <──> Neon (banco de dados)
        │                              ▲
        └── GitHub Actions, algumas vezes por dia: "busque as novidades do banco"
                                       ▲
                     você entra com a sua conta Google
```

| Peça | O que faz |
|---|---|
| **GitHub** | Guarda a sua cópia do código. Toda mudança nele publica uma versão nova do site. Também "acorda" o sistema algumas vezes por dia para buscar as novidades do banco. |
| **Neon** | Guarda os seus dados (lançamentos, categorias, dívidas…) num banco de dados Postgres. |
| **Render** | Monta e deixa o site no ar, num endereço como `https://meu-financeiro.onrender.com`. |
| **Google Cloud** | Permite o botão **Entrar com Google**, aceitando só o seu e-mail. |
| **Pluggy / MeuPluggy** | Entrega as transações da conta e do cartão pelo Open Finance. O sistema **só lê**: nunca movimenta dinheiro. |

## O que você vai precisar

| Conta | Site | Custo |
|---|---|---|
| GitHub | https://github.com | Grátis |
| Neon | https://neon.com | Grátis (até 0,5 GB, sobra para anos de uso) |
| Render | https://render.com | Grátis (750 horas por mês, o suficiente para um serviço ligado o mês todo) |
| Google Cloud | https://console.cloud.google.com | Grátis (use a mesma conta Google com que você vai entrar no sistema) |
| MeuPluggy | https://meu.pluggy.ai | Grátis para uso pessoal |
| Pluggy Dashboard | https://dashboard.pluggy.ai | Veja o aviso sobre o período de teste no [Passo 6](#passo-6-pluggy-ligar-os-seus-bancos) |

Os planos grátis mudam com o tempo: confira as condições na hora de criar cada conta.

Para os seus bancos: o app do banco instalado no celular (a autorização do Open Finance é feita por ele).

## Passo 0. Prepare uma anotação segura

Ao longo do caminho você vai copiar alguns códigos. Guarde-os num lugar seguro e só seu (um gerenciador de senhas é o ideal). **Não mande para ninguém, não cole em grupos nem tire print.**

| Nome | De onde vem | Passo |
|---|---|---|
| `DATABASE_URL` | Neon | 2 |
| `FINANCEIRO_TOKEN_SYNC` | Você gera | 3 |
| `FINANCEIRO_SENHA` | Você inventa | 3 |
| Endereço do site (`https://….onrender.com`) | Render | 4 |
| `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` | Google Cloud | 5 |
| `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` | Pluggy Dashboard | 6 |
| `PLUGGY_ITEM_ID` (um por banco) | Pluggy Dashboard | 6 |

---

## Passo 1. GitHub: a sua cópia do código

O Render publica a partir de um repositório **seu** no GitHub. Por isso você precisa de uma cópia própria e **privada** do código.

### 1.1 Criar a conta

1. Entre em https://github.com e clique em **Sign up**.
2. Use o seu e-mail, crie uma senha e um nome de usuário, e confirme o código que chega por e-mail.
3. Recomendado: em **Settings → Password and authentication**, ligue a verificação em duas etapas.

### 1.2 Receber o código

Peça para quem te passou o sistema te adicionar ao repositório original (no GitHub dele: **Settings → Collaborators → Add people**, com o seu nome de usuário). Aceite o convite que chega por e-mail.

### 1.3 Criar o seu repositório privado

1. No GitHub, clique no **+** no canto superior direito → **New repository**.
2. **Repository name:** por exemplo `meu-financeiro`.
3. Marque **Private**. Não marque nenhuma opção de "Initialize" (README, .gitignore, licença): o repositório tem que nascer vazio.
4. Clique em **Create repository** e deixe a página aberta: ela mostra o endereço do repositório, no formato `https://github.com/SEU-USUARIO/meu-financeiro.git`.

### 1.4 Copiar o código para o seu repositório

Você precisa do **Git** instalado:

- **Mac:** abra o app **Terminal** e digite `git --version`. Se não estiver instalado, o Mac oferece instalar (aceite).
- **Windows:** instale o **Git for Windows** em https://git-scm.com/download/win (pode avançar com as opções padrão) e use o programa **Git Bash** que vem junto.

No terminal, rode um comando de cada vez, trocando os endereços pelos reais (o primeiro é o repositório original; o segundo é o seu, da etapa 1.3):

```bash
git clone https://github.com/DONO-ORIGINAL/REPOSITORIO-ORIGINAL.git meu-financeiro
```

```bash
cd meu-financeiro
```

```bash
git remote rename origin original
```

```bash
git remote add origin https://github.com/SEU-USUARIO/meu-financeiro.git
```

```bash
git push -u origin main
```

Na primeira vez o Git pede para você entrar no GitHub: uma janela do navegador abre, ou ele pede usuário e um **token** (crie em **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**, com acesso de escrita ao seu repositório).

Pronto: atualize a página do seu repositório e o código aparece lá. O nome `original` guardado no passo 3 serve para você [receber as versões novas](#receber-as-versões-novas) depois.

> **Por que não um "Fork"?** Também funciona, mas em forks o GitHub desliga as tarefas agendadas (Passo 7) até você ativá-las à mão, e o fork continua ligado ao repositório original. A cópia própria é mais simples de manter.

### 1.5 Dar um nome ao seu serviço

O endereço do seu site vai ser `https://NOME.onrender.com`, e o nome precisa ser único no Render inteiro.

1. No seu repositório no GitHub, abra o arquivo `render.yaml` e clique no lápis (**Edit this file**).
2. Na linha `name: financeiro`, troque `financeiro` por um nome seu, só com letras minúsculas, números e hífen (ex.: `financeiro-ana-souza`).
3. Clique em **Commit changes…** → **Commit changes**.

---

## Passo 2. Neon: o banco de dados

É onde os seus dados ficam guardados. O disco do Render é apagado a cada publicação, por isso os dados precisam ficar fora dele.

1. Entre em https://neon.com e clique em **Sign up**. O jeito mais simples é **Continue with GitHub** (ou com o Google).
2. Crie um projeto (**New project** / **Create project**):
   - **Project name:** `financeiro`
   - **Postgres version:** a que vier marcada
   - **Region:** **AWS US East (N. Virginia)** — a mesma região do Render, para o sistema ficar rápido.
3. Ao terminar, clique em **Connect** (no painel do projeto).
4. Na janela que abre:
   - Deixe o banco `neondb` e o papel (role) que vierem marcados.
   - **Desligue** a opção **Connection pooling**.
   - Copie a **connection string**. Ela começa com `postgresql://` e termina com `?sslmode=require` (às vezes com `&channel_binding=require` depois; pode manter).
5. Guarde como `DATABASE_URL` na sua anotação. **Ela é a senha do seu banco.**

Não precisa criar tabela nenhuma: o sistema cria tudo sozinho na primeira vez que liga.

---

## Passo 3. Gerar as chaves secretas

### 3.1 Token da sincronização (`FINANCEIRO_TOKEN_SYNC`)

É um texto aleatório comprido que deixa o GitHub pedir ao sistema "busque as novidades do banco" sem precisar de login. Gere um:

- **Mac ou Git Bash (Windows):**

  ```bash
  openssl rand -hex 32
  ```

- **Windows (PowerShell):**

  ```powershell
  $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | % { $_.ToString('x2') })
  ```

O resultado tem 64 letras e números. Copie e guarde como `FINANCEIRO_TOKEN_SYNC`.

### 3.2 Senha de emergência (`FINANCEIRO_USUARIO` e `FINANCEIRO_SENHA`)

O login normal vai ser com o Google, mas uma senha serve para o primeiro acesso e para emergências.

- `FINANCEIRO_USUARIO`: um nome de usuário qualquer (ex.: `ana`).
- `FINANCEIRO_SENHA`: uma senha **nova**, que você não usa em outro lugar, com **10 caracteres ou mais**.

O sistema também usa uma chave `FINANCEIRO_SEGREDO` para assinar o login, mas o Render gera essa sozinho.

---

## Passo 4. Render: colocar o site no ar

1. Entre em https://render.com e clique em **Get Started**. Escolha **GitHub** para entrar.
2. Quando o Render pedir acesso ao GitHub, escolha **Only select repositories** e marque o seu repositório `meu-financeiro`.
3. No painel do Render, clique em **New +** → **Blueprint**.
4. Escolha o seu repositório. O Render lê o arquivo `render.yaml` e mostra um serviço **Web Service**, plano **Free**, tipo **Docker**, região **Virginia**.
5. Dê um nome ao Blueprint (ex.: `financeiro`) e preencha as variáveis. **Por enquanto, só estas:**

   | Variável | O que colocar |
   |---|---|
   | `DATABASE_URL` | A connection string do Neon (Passo 2) |
   | `FINANCEIRO_USUARIO` | O usuário do Passo 3.2 |
   | `FINANCEIRO_SENHA` | A senha do Passo 3.2 |

   Deixe as outras em branco: você preenche nos próximos passos.

6. Clique em **Apply** (ou **Deploy Blueprint**).
7. Espere. A **primeira** publicação compila o servidor e leva de **10 a 30 minutos**. Acompanhe em **Logs**. As próximas são mais rápidas.
8. Quando aparecer **Live** (verde), o endereço do site aparece no topo da página do serviço, no formato `https://NOME.onrender.com`. Guarde na anotação.
9. Abra o endereço e entre com o usuário e a senha. Se aparecer a tela do sistema, está no ar.

> **Sobre o plano grátis:** o Render "dorme" o site depois de uns 15 minutos sem uso. O primeiro acesso depois disso leva **cerca de 1 minuto** para acordar. É normal.

**Como mudar uma variável depois:** no Render, abra o serviço → **Environment** → edite → **Save Changes**. O Render publica de novo sozinho (leva poucos minutos).

---

## Passo 5. Google: entrar com a sua conta Google

Aqui você cria uma "credencial" no Google que deixa o sistema mostrar o botão **Entrar com Google**. Só o e-mail que você indicar vai poder entrar.

### 5.1 Criar o projeto

1. Entre em https://console.cloud.google.com com a conta Google que você vai usar no sistema. Aceite os termos se for a primeira vez.
2. No topo, clique no seletor de projeto → **Novo projeto**. Nome: `Financeiro`. Clique em **Criar** e depois selecione esse projeto no seletor.

### 5.2 Tela de permissão

1. No menu (☰), vá em **APIs e serviços → Tela de permissão OAuth** (em algumas contas aparece como **Google Auth Platform → Branding/Público-alvo**). Clique em **Começar** / **Configurar**.
2. Preencha:
   - **Nome do app:** `Financeiro`
   - **E-mail para suporte do usuário:** o seu
   - **Público-alvo / Tipo de usuário:** **Externo**
   - **Dados de contato:** o seu e-mail
3. Conclua. O app fica em modo **Teste** — é assim que deve ficar, não precisa publicar.
4. Em **Público-alvo** (ou **Usuários de teste**), clique em **Adicionar usuários** e coloque o **seu e-mail**. Salve.

O sistema só pede o seu e-mail ao Google (`openid` e `email`), nada além disso.

### 5.3 Criar a credencial

1. Vá em **APIs e serviços → Credenciais** (ou **Google Auth Platform → Clientes**).
2. **Criar credenciais → ID do cliente OAuth**.
3. **Tipo de aplicativo:** **Aplicativo da Web**. Nome: `Financeiro`.
4. Em **URIs de redirecionamento autorizados**, clique em **Adicionar URI** e cole, trocando pelo seu endereço do Render:

   ```
   https://NOME.onrender.com/api/auth/google/retorno
   ```

   Se for rodar no computador também, adicione `http://127.0.0.1:8080/api/auth/google/retorno`.

5. Clique em **Criar**. Aparecem o **ID do cliente** (termina em `.apps.googleusercontent.com`) e a **Chave secreta do cliente**. Guarde os dois.

### 5.4 Colocar no Render

No Render → seu serviço → **Environment**, preencha e salve:

| Variável | O que colocar |
|---|---|
| `GOOGLE_CLIENT_ID` | O ID do cliente |
| `GOOGLE_CLIENT_SECRET` | A chave secreta do cliente |
| `FINANCEIRO_EMAIL` | O seu e-mail do Google, o único que vai poder entrar |

Depois da publicação, a tela de entrada mostra **Entrar com Google**. A senha do Passo 3 continua valendo como acesso de emergência; se quiser desligá-la, apague `FINANCEIRO_USUARIO` e `FINANCEIRO_SENHA` do Environment.

---

## Passo 6. Pluggy: ligar os seus bancos

É a parte que mais confunde, porque são **dois sites diferentes** da Pluggy:

| Site | Para que serve | Pense nele como |
|---|---|---|
| **meu.pluggy.ai** | Você conecta os seus bancos (como pessoa) | o seu "cofre" |
| **dashboard.pluggy.ai** | Você cria uma "aplicação" que o sistema usa para ler o cofre | a "chave" que o sistema usa |

Use o **mesmo e-mail** nos dois.

### 6.1 Conectar os bancos no meu.pluggy.ai

1. Entre em https://meu.pluggy.ai e crie a sua conta.
2. Vá em **Conexões → Conectar conta**.
3. Escolha o banco. Você vai para o app do banco para autorizar o compartilhamento (Open Finance). Autorize **conta corrente e cartão de crédito**. O consentimento vale por até 12 meses.
4. Repita para cada banco (até 5 conexões do mesmo titular).
5. Espere cada banco aparecer na lista **com transações** (pode levar alguns minutos).

### 6.2 Criar a aplicação no dashboard

1. Entre em https://dashboard.pluggy.ai e crie a sua conta (mesmo e-mail).
2. Em **Aplicações**, clique em criar uma aplicação. Nome: `Financeiro`.
3. Abra a aplicação e copie o **Client ID** e o **Client Secret**. Guarde os dois. O Client Secret é uma senha.

### 6.3 Trazer cada banco para a aplicação

Faça isto **uma vez para cada banco**:

1. Na sua aplicação no dashboard, abra a tela de teste (botão de play / **Demo**) e clique em **Conectar Conta**.
2. Procure e escolha o conector **MeuPluggy**. Entre com a sua conta do meu.pluggy.ai.
3. Marque **só um banco desta vez** (ex.: só o Nubank) e autorize logo, porque a tela expira em poucos minutos.
4. Volte à aplicação → **Itens Conectados**. Aparece um item "MeuPluggy" com status **Atualizado**. Abra e confira na aba **Contas** se é o banco certo.
5. Copie o **id do item**: o código que aparece **em cima do nome do item**, no formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

Cuidados importantes:

- O id certo é o do **item**, na lista de Itens Conectados do dashboard. **Não** é o id da aplicação, nem o que aparece na barra de endereço do meu.pluggy.ai.
- **Um banco por item.** Se o mesmo banco estiver em dois itens, os lançamentos entram em dobro.

### 6.4 Colocar no Render

No Render → **Environment**, preencha e salve:

| Variável | O que colocar |
|---|---|
| `PLUGGY_CLIENT_ID` | Client ID da aplicação |
| `PLUGGY_CLIENT_SECRET` | Client Secret da aplicação |
| `PLUGGY_ITEM_ID` | Os ids dos itens, separados por vírgula e sem espaço: `id-do-banco-1,id-do-banco-2` |
| `FINANCEIRO_TOKEN_SYNC` | O token do Passo 3.1 |

### 6.5 Buscar as transações pela primeira vez

1. Abra o seu sistema e entre.
2. Clique no botão de **atualizar** (setas em círculo) na barra do topo.
3. Para trazer o último ano inteiro: **Ajustes → Histórico do banco → Buscar os últimos 12 meses**. (O Open Finance só entrega cerca de 12 meses; mais antigo que isso, só enviando extratos em **Ajustes → Documentos (legado)**.)

### 6.6 Acrescentar um banco depois

1. Conecte o banco novo no meu.pluggy.ai (6.1).
2. Repita o 6.3 marcando **só o banco novo**.
3. No Render, **acrescente** o id novo no fim de `PLUGGY_ITEM_ID`, depois de uma vírgula.

**Não apague nem troque os itens que já funcionam:** um item novo gera ids novos para as mesmas transações, e o histórico entraria de novo.

### Sobre o tempo de atualização e o período de teste

- O MeuPluggy lê os seus bancos **uma vez a cada 24 horas**, sozinho. O botão de atualizar só busca o que ele já leu. A barra do topo mostra a hora real dessa leitura ("Dados do banco de ontem às 15:50"). Por isso, compras e Pix muito recentes podem ainda não aparecer.
- O dashboard da Pluggy mostra um **período de teste (trial)** ao criar a aplicação. O MeuPluggy é gratuito para uso pessoal, mas confira, quando o trial acabar, se a sincronização continua funcionando: se a Pluggy recusar, a barra do topo do sistema mostra o erro.

---

## Passo 7. Sincronização automática (GitHub Actions)

O Render grátis dorme, então ninguém busca as novidades do banco se você não abrir o sistema. Um "robô" do GitHub resolve isso: algumas vezes por dia (8h, 12h, 16h30, 19h e 22h de Brasília) ele acorda o sistema e pede para sincronizar. Ele já vem pronto no código; você só precisa dar a ele o endereço e o token.

1. No seu repositório no GitHub: **Settings → Secrets and variables → Actions**.
2. Clique em **New repository secret** e crie os dois:

   | Name | Secret |
   |---|---|
   | `FINANCEIRO_URL` | O endereço do seu site, ex.: `https://NOME.onrender.com` (sem barra no fim) |
   | `FINANCEIRO_TOKEN_SYNC` | **O mesmo** token que você pôs no Render |

3. Teste na hora: aba **Actions** → **Sincronizar banco** → **Run workflow** → **Run workflow**. Em um ou dois minutos a execução aparece com um sinal verde. O registro mostra só contagens, nunca valores.

Se a aba Actions pedir para habilitar os workflows, clique em **I understand my workflows, go ahead and enable them**.

---

## Passo 8. Primeiro uso

1. Entre com o Google.
2. **Categorias:** na primeira vez, a tela de migração cria os seus grupos de gasto. Depois, crie, renomeie ou exclua à vontade.
3. **Movimentos:** escolha a categoria do que o sistema não reconheceu (o **modo rápido** ajuda a organizar vários de uma vez). Ele aprende e aplica nas próximas compras iguais.
4. **Dívidas, Contas fixas, Pessoas e Objetivos:** cadastre o que o banco não informa (parcelamentos, empréstimos, dinheiro emprestado a alguém, metas).
5. **Ajustes → Suas contas:** marque como **Reserva** a conta onde fica a sua reserva de emergência. Ela aparece à parte e a meta de reserva acompanha o saldo dela.
6. **Instale no celular:**
   - **Android (Chrome):** **Ajustes → Instalar app**, ou no menu do Chrome → **Adicionar à tela inicial**.
   - **iPhone (Safari):** botão **Compartilhar** → **Adicionar à Tela de Início**.
7. **Avisos no celular:** **Ajustes → Avisos no celular → Ativar avisos neste aparelho**. Escolha quais receber (conta fixa vencendo, cobrança que parece assinatura, fatura do cartão, resumo do mês) e use **Enviar aviso de teste** para conferir. No iPhone só funciona com o sistema instalado na Tela de Início (iOS 16.4 ou mais novo).
8. **Faça uma cópia de segurança** de vez em quando: **Ajustes → Cópia de segurança → Baixar cópia (.json)**. O Neon grátis não garante backup.

Pronto: o seu sistema está no ar.

---

# Parte 2 — Dia a dia

## As telas do sistema

| Tela | Para quê |
|---|---|
| **Início** | O mês na palma da mão: quanto sobrou, para onde foi o dinheiro, fatura atual do cartão (com melhor dia de compra), quanto dá para gastar por dia **até o salário** com a previsão do saldo, **limites de gasto** por categoria, próximas contas e reserva |
| **Movimentos** | Todas as entradas e saídas, com etiqueta de origem (crédito, débito, reserva, dinheiro). Busca, filtros, mudar categoria, dar nome, dividir um lançamento em partes, ligar a uma dívida, pessoa ou conta fixa, e o modo rápido para organizar os pendentes |
| **Dívidas** | Por tipo (cartão parcelado, empréstimos, pessoas, outras): quanto deve, juros que faltam, peso no salário, quando fica livre, simulador de adiantamento e ordem sugerida. Confirma pagamentos achados no banco |
| **Objetivos** | Reserva de emergência, metas e "vou receber um dinheiro" |
| **Análises** | Seis perguntas respondidas em uma frase e um gráfico |
| **Fechamento** | Resumo de um mês fechado: abra pelo card em Análises ou pelo aviso no Início nos dias 1 a 7. **Baixar PDF** abre a impressão do navegador ("Salvar como PDF") |
| **Contas fixas, Pessoas, Salários** | Contas do mês, empréstimos entre pessoas, holerites |
| **Categorias** | Os seus grupos de gasto e as origens das entradas |
| **Ajustes** | Tema, avisos no celular, suas contas, histórico do banco, cópia de segurança, documentos e sair |

Dicas:

- **+ Lançar** registra um gasto ou entrada à mão (dinheiro vivo, por exemplo).
- O **olho** na barra do topo esconde todos os valores (bom para usar em público).
- O seletor de mês no topo vale para quase todas as telas; em **Dívidas**, um mês futuro mostra a projeção ("quanto vou dever em março").

## Receber as versões novas

Quando quem te passou o sistema publicar melhorias, traga para a sua cópia. Na pasta `meu-financeiro` do Passo 1, no terminal:

```bash
git pull original main
```

```bash
git push origin main
```

O Render publica a versão nova sozinho em alguns minutos. Se o `git pull` reclamar de conflito no `render.yaml`, mantenha o **seu** nome de serviço.

Antes de atualizar, baixe uma cópia de segurança (**Ajustes → Cópia de segurança**), por garantia.

## Quando algo não funciona

| O que aparece | Causa | O que fazer |
|---|---|---|
| Site leva até 1 minuto para abrir | Plano grátis dormindo | Normal |
| "O servidor está no ar, mas o sistema não conseguiu iniciar" | Variável faltando ou banco não conectou | A página diz qual. Corrija no **Environment** do Render e salve |
| Publicação com status **Failed** no Render | Erro ao montar | Render → **Events** → clique na publicação → leia as últimas linhas do log |
| "No open ports detected" | `PORT` ou `FINANCEIRO_ENDERECO` definidos à mão | Apague as duas do Environment |
| "FINANCEIRO_SENHA precisa ter pelo menos 10 caracteres" | Senha curta | Use 10 caracteres ou mais |
| "FINANCEIRO_TOKEN_SYNC precisa ter pelo menos 32 caracteres" | Token curto ou incompleto | Gere de novo (Passo 3.1) e cole inteiro no Render e no GitHub |
| "Esta conta do Google não tem acesso" | E-mail diferente de `FINANCEIRO_EMAIL` | Entre com o e-mail certo ou corrija a variável |
| Erro `redirect_uri_mismatch` no Google | Endereço de retorno diferente do cadastrado | Cadastre exatamente `https://NOME.onrender.com/api/auth/google/retorno` (Passo 5.3) |
| "Acesso bloqueado: o app não concluiu o processo de verificação" | Seu e-mail não está nos usuários de teste | Google Cloud → Público-alvo → adicione o seu e-mail (Passo 5.2) |
| "ITEM_NOT_FOUND" ou "PLUGGY_ITEM_ID não pertence a esta aplicação" | Id errado (da aplicação ou do meu.pluggy.ai) | Use o id de cima do item em **Itens Conectados** do dashboard (Passo 6.3) |
| Lançamentos de um banco em dobro | O mesmo banco em dois itens | Deixe cada banco em um item só |
| Aviso de autorização vencendo | Consentimento do Open Finance perto de 12 meses | meu.pluggy.ai → Conexões → autorize de novo |
| Robô do GitHub com sinal vermelho | Segredo errado ou site fora do ar | Confira `FINANCEIRO_URL` e se o `FINANCEIRO_TOKEN_SYNC` é igual nos dois lugares |

Se criou serviços repetidos no Render, apague os que sobram (**Settings → Delete Web Service**): eles dividem as mesmas 750 horas grátis.

## Privacidade e segurança

- Nada é mostrado sem login. Com o Google, só o e-mail de `FINANCEIRO_EMAIL` entra. No login por senha, 5 erros seguidos travam o login por 5 minutos.
- Chaves e senhas ficam **só** no Environment do Render, nos segredos do GitHub e na sua anotação segura. **Nunca** no código.
- Mantenha o seu repositório **privado**.
- **Nunca** coloque no Git: `.env`, a pasta `dados/`, cópias de segurança (`financeiro-backup-*.json`), holerites, faturas e extratos. O `.gitignore` já bloqueia esses arquivos.
- Se alguma chave vazar, gere outra no painel correspondente (Neon, Google, Pluggy) e troque no Render.

---

# Parte 3 — Para quem vai mexer no código

- **Back-end:** Rust ([axum](https://github.com/tokio-rs/axum)). Uma API em `/api/*` que também serve o front compilado.
- **Front-end:** React + TypeScript ([Vite](https://vitejs.dev)), gráficos em Chart.js, instalável como app (PWA) com avisos por Web Push.
- **Dados:** no computador, arquivos JSON na pasta `dados/` (fora do Git). Online, Postgres (Neon). Formato em [docs/MODELO_DE_DADOS.md](docs/MODELO_DE_DADOS.md).

## Rodar no seu computador

### Requisitos

- **Git**
- **Rust** 1.80 ou mais novo — instale com [rustup](https://rustup.rs)
- **Node.js** 20 ou mais novo (com npm)
- (Opcional) **Python 3**, só para o script que testa a conexão com a Pluggy

### Primeira execução

```bash
cp .env.example .env
```

```bash
cd frontend && npm install && npm run build && cd ..
```

```bash
cargo run --release --manifest-path backend/Cargo.toml
```

Abra **http://127.0.0.1:8080**.

- A primeira compilação do Rust demora alguns minutos; as seguintes são rápidas.
- Na primeira vez, a pasta `dados/` é criada a partir de `dados-exemplo/` (vazia).
- Sem login configurado, o sistema só aceita acesso da própria máquina (127.0.0.1). Isso é proposital.
- Sem Pluggy, os lançamentos entram à mão (**+ Lançar**) ou por documento (**Ajustes → Documentos (legado)**).

O [`.env.example`](.env.example) explica cada variável. O que já estiver definido no ambiente vale mais que o arquivo; para usar outro arquivo, `FINANCEIRO_ENV=/caminho/outro.env`.

Para testar a conexão com a Pluggy usando o `.env` (só leitura): `python3 scripts/pluggy_teste.py`.

### Desenvolvimento com recarga automática

Em dois terminais:

```bash
cargo run --manifest-path backend/Cargo.toml
```

```bash
cd frontend && npm run dev
```

Abra **http://localhost:5173**: o Vite repassa `/api` para o servidor da porta 8080.

Para testar com dados de mentira sem tocar nos seus: `FINANCEIRO_DADOS=/tmp/financeiro-teste` (copie `dados-exemplo/` para lá antes). Para ignorar o `.env` (sem login e sem Pluggy): `FINANCEIRO_ENV=/dev/null`.

## Estrutura, testes e convenções

```
backend/src/
  main.rs            rotas da API e handlers
  armazenamento.rs   leitura e gravação dos JSON (pasta ou Postgres), com versões
  auth.rs            login (Google e senha) e sessão
  pluggy.rs          sincronização com a Pluggy (transações, saldos, faturas fechadas)
  categorias.rs      grupos, migração das categorias, sugestões
  lancamentos.rs     partes, vínculos e "quem" de um lançamento
  dividas.rs         tipos de dívida e pagamento de parcelas
  fixas.rs           contas fixas
  orcamentos.rs      limites de gasto por categoria
  avisos.rs, push.rs avisos no celular (regras e envio Web Push/VAPID)
  calculos.rs        indicadores da visão geral
  importar/          leitura de holerite, fatura e extrato (documentos)
frontend/src/
  App.tsx            esqueleto, rotas (#inicio, #movimentos…) e carga dos dados
  api.ts             tipos e chamadas à API
  *.ts               regras puras e testadas (movimentos, dividas, analises, previsao, orcamento, fechamento…)
  paginas/           uma tela por arquivo
  componentes/       menu, barra do topo, janelas, gráficos, avisos
frontend/testes/     testes das regras (Node)
docs/                modelo de dados, especificações, planos e protótipo
dados-exemplo/       arquivos vazios usados para criar dados/ na primeira vez
```

### Testes

```bash
cargo test --manifest-path backend/Cargo.toml
```

```bash
cd frontend && npm run teste && npm run build
```

O GitHub roda os dois a cada push (`.github/workflows/ci.yml`). As regras de negócio ficam em funções puras (Rust em `backend/src/*.rs`, TypeScript em `frontend/src/*.ts`) com teste ao lado; as telas só desenham.

### Convenções

- **Português do Brasil** em tudo: textos da tela, nomes no código, comentários e mensagens de commit.
- Uma branch por mudança, partindo da `main`; Pull Request descrevendo o que mudou e como testou.
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
| `PUT /api/orcamentos/{categoria}` | Limite de gasto de uma categoria |
| `POST /api/sincronizar`, `GET /api/sincronizacao` | Busca na Pluggy e estado da última busca |
| `GET /api/avisos`, `POST/DELETE /api/avisos/aparelhos…`, `PUT /api/avisos/tipos`, `POST /api/avisos/teste` | Avisos no celular |
| `GET/POST /api/backup` | Baixa ou restaura a cópia de segurança |

A lista completa está em `backend/src/main.rs` (procure por `.route(`).
