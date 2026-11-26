# Publicação avançada

O caminho principal (GitHub + Neon + Render + Google + Pluggy, tudo grátis) está passo a passo no [README](README.md#parte-1--montar-o-seu-sistema-online). Este arquivo cobre dois extras opcionais:

1. [Domínio próprio com as telas num site separado](#1-domínio-próprio-com-as-telas-num-site-separado)
2. [Publicar em outro lugar (qualquer serviço com Docker)](#2-publicar-em-outro-lugar-qualquer-serviço-com-docker)

---

## 1. Domínio próprio com as telas num site separado

No plano grátis, o servidor dorme depois de uns 15 minutos parado e, ao acordar, quem responde é o Render, com a tela de carregamento dele. Separando as telas num **site estático** (grátis e não dorme), o seu site abre na hora com "Estamos carregando seus dados" enquanto o servidor acorda.

Precisa de um domínio seu (ex.: comprado no Registro.br). Exemplo com `app.seudominio.com.br` (telas) e `api.seudominio.com.br` (servidor). Faça **nesta ordem**, para o login não parar no meio:

1. **Site estático no Render.** **New + → Static Site**, o mesmo repositório, com:
   - **Build Command:** `cd frontend && npm ci && npm run build`
   - **Publish Directory:** `frontend/dist`
   - Variável `VITE_API_URL` = `https://api.seudominio.com.br`
   - Em **Redirects/Rewrites**: origem `/*`, destino `/index.html`, ação **Rewrite**.
2. **DNS do servidor.** No painel do seu domínio, crie um registro **CNAME** `api` apontando para o endereço `.onrender.com` do serviço web. No Render, em **Settings → Custom Domains** do serviço web, adicione `api.seudominio.com.br` e espere o certificado ficar verde.
3. **Google.** No Google Cloud, em **APIs e serviços → Credenciais →** o seu cliente OAuth, acrescente em "URIs de redirecionamento autorizados": `https://api.seudominio.com.br/api/auth/google/retorno` (pode manter os antigos).
4. **Variáveis do serviço web** (Environment): `FINANCEIRO_URL_PUBLICA` = `https://api.seudominio.com.br` e `FINANCEIRO_URL_APP` = `https://app.seudominio.com.br`. Salve e espere publicar.
5. **Domínio das telas.** No site estático, em **Settings → Custom Domains**, adicione `app.seudominio.com.br`. No DNS, crie o CNAME `app` apontando para o endereço `.onrender.com` do site estático.
6. **Testar.** Abra `https://app.seudominio.com.br`, saia e entre com o Google: deve voltar para o `app`. O endereço antigo `.onrender.com` das telas passa a levar para o `app`; a sincronização do GitHub Actions continua funcionando nele.

O Render grátis aceita até 2 domínios próprios por conta.

---

## 2. Publicar em outro lugar (qualquer serviço com Docker)

O Render e o Neon são só uma opção grátis. O sistema é uma imagem Docker só (`Dockerfile`: front compilado + servidor) e roda em qualquer lugar que aceite Docker: Railway, Fly.io, Koyeb, Google Cloud Run, um VPS seu etc.

**Onde guardar os dados (escolha um):**

- **Postgres** (recomendado): Neon, Supabase, Railway, Aiven ou o seu. Coloque a connection string em `DATABASE_URL` (com TLS, ex.: `?sslmode=require`). As tabelas são criadas sozinhas.
- **Arquivos JSON num disco persistente**: deixe `DATABASE_URL` vazio e aponte `FINANCEIRO_DADOS` para uma pasta num volume que sobreviva às publicações (ex.: `/dados`). Sem volume persistente, os dados somem a cada publicação.

**Variáveis mínimas:**

| Variável | Valor |
|---|---|
| `DATABASE_URL` ou `FINANCEIRO_DADOS` | Ver acima |
| `FINANCEIRO_USUARIO` e `FINANCEIRO_SENHA`, e/ou o login com Google (README, Passo 5) | Fora da máquina local o sistema **não sobe sem login** |
| `FINANCEIRO_SEGREDO` | 32+ caracteres aleatórios (`openssl rand -hex 32`) |
| `FINANCEIRO_URL_PUBLICA` | O endereço público, ex.: `https://financeiro.seudominio.com.br` (usado no retorno do Google) |
| `PORT` | Quase todo serviço define sozinho. Se não, use `FINANCEIRO_ENDERECO=0.0.0.0:8080` |
| `PLUGGY_*` e `FINANCEIRO_TOKEN_SYNC` | README, Passos 3 e 6 |

**Exemplo num servidor seu com Docker:**

```bash
docker build -t financeiro .
```

```bash
docker run -d --name financeiro --restart unless-stopped \
  --env-file .env \
  -e FINANCEIRO_ENDERECO=0.0.0.0:8080 \
  -e FINANCEIRO_DADOS=/dados -v financeiro-dados:/dados \
  -p 8080:8080 financeiro
```

Coloque um proxy com HTTPS na frente (Caddy, Nginx, Cloudflare Tunnel): o login usa cookies seguros e o Google exige HTTPS no endereço de retorno. No Google Cloud, cadastre `https://SEU-ENDERECO/api/auth/google/retorno`.

**Sincronização agendada:** nos segredos do GitHub (README, Passo 7), `FINANCEIRO_URL` passa a ser o seu endereço. Ou, no próprio servidor, um `cron` chamando:

```bash
curl -X POST "https://SEU-ENDERECO/api/sincronizar" -H "Authorization: Bearer $FINANCEIRO_TOKEN_SYNC" -H "x-financeiro: 1"
```
