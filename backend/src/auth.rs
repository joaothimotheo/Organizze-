//! Login de um único usuário, com sessão em cookie assinado.
//!
//! Duas formas de entrar, cada uma ligada pelo ambiente:
//! - **Google** (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FINANCEIRO_EMAIL`): OAuth 2.0 /
//!   OpenID Connect com PKCE. Só o e-mail de `FINANCEIRO_EMAIL` (verificado pelo Google) entra.
//! - **Senha** (`FINANCEIRO_USUARIO` + `FINANCEIRO_SENHA` ou `FINANCEIRO_SENHA_HASH` em Argon2).
//!   Ela é a senha deste sistema, nunca a do banco. Com o Google ligado, a senha é opcional
//!   e serve como acesso de emergência.
//!
//! O cookie `sessao` leva a validade e uma assinatura HMAC-SHA256 com `FINANCEIRO_SEGREDO`.
//! Trocar o segredo encerra todas as sessões. Depois de 5 senhas erradas, o login por senha
//! fica bloqueado por 5 minutos.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Result};
use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

const COOKIE: &str = "sessao";
const VALIDADE: Duration = Duration::from_secs(30 * 24 * 3600);
const MAX_ERROS: u32 = 5;
const BLOQUEIO: Duration = Duration::from_secs(5 * 60);

/// Cookie temporário que guarda `state`, verificador PKCE e `nonce` entre a ida ao Google e a volta.
const COOKIE_FLUXO: &str = "google_fluxo";
const CAMINHO_FLUXO: &str = "/api/auth/google";
const VALIDADE_FLUXO: Duration = Duration::from_secs(10 * 60);
/// Separa a assinatura do cookie do fluxo da assinatura da sessão: um não vale pelo outro.
const PROPOSITO_FLUXO: &str = "google-fluxo|";

const GOOGLE_AUTORIZAR: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_EMISSORES: [&str; 2] = ["https://accounts.google.com", "accounts.google.com"];

#[derive(Clone)]
pub struct Auth {
    inner: Option<Arc<Config>>,
    tentativas: Arc<Mutex<(u32, Option<Instant>)>>,
    http: reqwest::Client,
}

struct Config {
    senha: Option<Senha>,
    google: Option<Google>,
    segredo: Vec<u8>,
    cookie_seguro: bool,
    /// Token para o agendamento diário chamar `POST /api/sincronizar` sem sessão (`FINANCEIRO_TOKEN_SYNC`).
    token_sync: Option<String>,
}

struct Senha {
    usuario: String,
    hash: String,
}

struct Google {
    client_id: String,
    client_secret: String,
    /// Único e-mail aceito.
    email: String,
    /// Endereço de volta cadastrado no Google Cloud (`<url pública>/api/auth/google/retorno`).
    retorno: String,
}

fn var(nome: &str) -> String {
    std::env::var(nome).unwrap_or_default().trim().to_string()
}

/// Sem `FINANCEIRO_SEGREDO`, deriva a chave das sessões de valores que já são secretos
/// (`DATABASE_URL` e a senha ou, sem senha, o `GOOGLE_CLIENT_SECRET`). Assim um serviço criado
/// à mão no Render funciona sem a variável extra; trocar a senha, o segredo do Google ou o
/// banco encerra as sessões abertas.
fn segredo_derivado() -> Result<Vec<u8>> {
    let banco = var("DATABASE_URL");
    let senha = std::env::var("FINANCEIRO_SENHA")
        .or_else(|_| std::env::var("FINANCEIRO_SENHA_HASH"))
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| var("GOOGLE_CLIENT_SECRET"));
    if banco.is_empty() || senha.is_empty() {
        bail!("defina FINANCEIRO_SEGREDO (texto aleatório com 32 caracteres ou mais)");
    }
    tracing::warn!("FINANCEIRO_SEGREDO não definido: usando chave derivada de DATABASE_URL e da senha/segredo do Google");
    let mut h = Sha256::new();
    h.update(b"financeiro/sessao/v1\0");
    h.update(banco.as_bytes());
    h.update(b"\0");
    h.update(senha.as_bytes());
    Ok(h.finalize().to_vec())
}

impl Auth {
    /// Lê a configuração do ambiente. Sem nenhuma forma de login, só aceita rodar na própria máquina.
    pub fn do_ambiente(somente_local: bool, endereco: SocketAddr, http: reqwest::Client) -> Result<Self> {
        let senha = Self::senha_do_ambiente()?;
        let google = Self::google_do_ambiente(endereco)?;
        if senha.is_none() && google.is_none() {
            if somente_local {
                tracing::warn!("sem login configurado: acesso livre (aceito só porque o endereço é local)");
                return Ok(Self { inner: None, tentativas: Default::default(), http });
            }
            bail!("configure o login com Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e FINANCEIRO_EMAIL) ou com senha (FINANCEIRO_USUARIO e FINANCEIRO_SENHA) para rodar fora da própria máquina");
        }
        let segredo = match std::env::var("FINANCEIRO_SEGREDO").unwrap_or_default() {
            s if s.len() >= 32 => s.into_bytes(),
            s if !s.is_empty() => bail!("FINANCEIRO_SEGREDO precisa ter pelo menos 32 caracteres aleatórios (ou apague a variável)"),
            _ => segredo_derivado()?,
        };
        let cookie_seguro = std::env::var("FINANCEIRO_COOKIE_SEGURO").map(|v| v != "0").unwrap_or(!somente_local);
        let token_sync = match var("FINANCEIRO_TOKEN_SYNC") {
            t if t.is_empty() => None,
            t if t.len() < 32 => bail!("FINANCEIRO_TOKEN_SYNC precisa ter pelo menos 32 caracteres aleatórios"),
            t => Some(t),
        };
        Ok(Self {
            inner: Some(Arc::new(Config { senha, google, segredo, cookie_seguro, token_sync })),
            tentativas: Default::default(),
            http,
        })
    }

    fn senha_do_ambiente() -> Result<Option<Senha>> {
        let hash = match (var("FINANCEIRO_SENHA_HASH"), std::env::var("FINANCEIRO_SENHA").unwrap_or_default()) {
            (h, _) if !h.is_empty() => {
                PasswordHash::new(&h).map_err(|e| anyhow!("FINANCEIRO_SENHA_HASH inválido: {e}"))?;
                h
            }
            (_, s) if !s.is_empty() => {
                if s.chars().count() < 10 {
                    bail!("FINANCEIRO_SENHA precisa ter pelo menos 10 caracteres");
                }
                gerar_hash(&s)?
            }
            _ => return Ok(None),
        };
        let usuario = var("FINANCEIRO_USUARIO");
        if usuario.is_empty() {
            bail!("defina FINANCEIRO_USUARIO (ou apague FINANCEIRO_SENHA para usar só o Google)");
        }
        Ok(Some(Senha { usuario, hash }))
    }

    fn google_do_ambiente(endereco: SocketAddr) -> Result<Option<Google>> {
        let client_id = var("GOOGLE_CLIENT_ID");
        if client_id.is_empty() {
            return Ok(None);
        }
        if client_id.contains("://") || client_id.contains('/') || !client_id.ends_with(".apps.googleusercontent.com") {
            bail!("GOOGLE_CLIENT_ID fora do formato: deve ser só o ID (ex.: 1234-abc.apps.googleusercontent.com), sem https:// e sem barra");
        }
        let client_secret = var("GOOGLE_CLIENT_SECRET");
        if client_secret.is_empty() {
            bail!("defina GOOGLE_CLIENT_SECRET (vem junto com o GOOGLE_CLIENT_ID no Google Cloud)");
        }
        let email = var("FINANCEIRO_EMAIL").to_lowercase();
        if !email.contains('@') {
            bail!("defina FINANCEIRO_EMAIL com o e-mail do Google que pode entrar");
        }
        // No Render, RENDER_EXTERNAL_URL já vem preenchida com o link do serviço.
        let base = [var("FINANCEIRO_URL_PUBLICA"), var("RENDER_EXTERNAL_URL")].into_iter().find(|u| !u.is_empty());
        let base = match base {
            Some(b) => b,
            None if endereco.ip().is_loopback() => format!("http://{endereco}"),
            None => bail!("defina FINANCEIRO_URL_PUBLICA com o link do sistema (ex.: https://meu-app.onrender.com)"),
        };
        let base = base.trim_end_matches('/');
        if !(base.starts_with("https://") || base.starts_with("http://")) {
            bail!("FINANCEIRO_URL_PUBLICA deve começar com https://");
        }
        Ok(Some(Google { client_id, client_secret, email, retorno: format!("{base}{CAMINHO_FLUXO}/retorno") }))
    }

    pub fn exigida(&self) -> bool {
        self.inner.is_some()
    }

    /// Endereço de volta do Google, para mostrar no log de partida (precisa estar cadastrado no Google Cloud).
    pub fn retorno_google(&self) -> Option<&str> {
        self.inner.as_ref()?.google.as_ref().map(|g| g.retorno.as_str())
    }

    fn assinar(c: &Config, carga: &str) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(&c.segredo).expect("hmac aceita qualquer tamanho");
        mac.update(carga.as_bytes());
        B64.encode(mac.finalize().into_bytes())
    }

    fn assinatura_confere(c: &Config, carga: &str, assinatura: &str) -> bool {
        let Ok(assinatura) = B64.decode(assinatura) else { return false };
        let mut mac = Hmac::<Sha256>::new_from_slice(&c.segredo).expect("hmac");
        mac.update(carga.as_bytes());
        mac.verify_slice(&assinatura).is_ok()
    }

    fn emitir(c: &Config) -> String {
        let exp = chrono::Utc::now().timestamp() + VALIDADE.as_secs() as i64;
        let carga = format!("{exp}.{}", aleatorio(16));
        format!("{carga}.{}", Self::assinar(c, &carga))
    }

    fn valido(&self, token: &str) -> bool {
        let Some(c) = &self.inner else { return true };
        let Some((carga, assinatura)) = token.rsplit_once('.') else { return false };
        if !Self::assinatura_confere(c, carga, assinatura) {
            return false;
        }
        let exp: i64 = carga.split('.').next().and_then(|e| e.parse().ok()).unwrap_or(0);
        exp > chrono::Utc::now().timestamp()
    }

    /// `Authorization: Bearer <FINANCEIRO_TOKEN_SYNC>` (só vale para a sincronização).
    fn token_sync_confere(&self, headers: &HeaderMap) -> bool {
        let Some(esperado) = self.inner.as_ref().and_then(|c| c.token_sync.as_deref()) else { return false };
        headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .is_some_and(|t| iguais(t.trim(), esperado))
    }

    pub fn autenticado(&self, headers: &HeaderMap) -> bool {
        if self.inner.is_none() {
            return true;
        }
        cookie(headers, COOKIE).is_some_and(|t| self.valido(&t))
    }

    fn seguro(&self) -> &'static str {
        if self.inner.as_ref().is_some_and(|c| c.cookie_seguro) {
            "; Secure"
        } else {
            ""
        }
    }

    /// `SameSite=Lax`: com `Strict`, o navegador não manda o cookie na volta do Google
    /// (navegação vinda de outro site). Gravações continuam protegidas pelo cabeçalho `x-financeiro`.
    fn cookie_header(&self, valor: &str, max_age: u64) -> HeaderValue {
        let s = format!("{COOKIE}={valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{}", self.seguro());
        HeaderValue::from_str(&s).expect("cookie ascii")
    }

    fn cookie_fluxo(&self, valor: &str, max_age: u64) -> HeaderValue {
        let s = format!("{COOKIE_FLUXO}={valor}; Path={CAMINHO_FLUXO}; HttpOnly; SameSite=Lax; Max-Age={max_age}{}", self.seguro());
        HeaderValue::from_str(&s).expect("cookie ascii")
    }
}

pub fn gerar_hash(senha: &str) -> Result<String> {
    let sal = SaltString::generate(&mut OsRng);
    Ok(Argon2::default().hash_password(senha.as_bytes(), &sal).map_err(|e| anyhow!("{e}"))?.to_string())
}

/// `n` bytes aleatórios em base64 URL (só letras, números, `-` e `_`: serve para cookie e PKCE).
fn aleatorio(n: usize) -> String {
    let mut b = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut b);
    B64.encode(b)
}

fn cookie(headers: &HeaderMap, nome: &str) -> Option<String> {
    headers.get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok()).flat_map(|v| v.split(';')).find_map(|par| {
        let (k, v) = par.trim().split_once('=')?;
        (k == nome).then(|| v.to_string())
    })
}

fn erro(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "erro": msg }))).into_response()
}

/// Endereço das telas (`FINANCEIRO_URL_APP`, ex.: `https://app.seudominio.com.br`), quando ficam num site
/// separado da API. Vazio = as telas são servidas por este mesmo servidor.
pub fn url_app() -> &'static str {
    static URL: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| app_valida(&std::env::var("FINANCEIRO_URL_APP").unwrap_or_default()));
    URL.as_str()
}

/// Aceita só `https://…` (ou `http://` local, para testes), sem a barra do fim; o resto vira vazio.
fn app_valida(v: &str) -> String {
    let v = v.trim().trim_end_matches('/');
    let local = v.starts_with("http://localhost") || v.starts_with("http://127.0.0.1");
    if (v.starts_with("https://") || local) && !v.contains(['?', '#', ' ']) && v.matches('/').count() == 2 {
        v.to_string()
    } else {
        if !v.is_empty() {
            tracing::warn!("FINANCEIRO_URL_APP ignorada: use só o endereço, como https://app.exemplo.com.br");
        }
        String::new()
    }
}

/// Volta para as telas: no site das telas, se separado; senão, neste mesmo servidor.
fn para_o_app(caminho: &str) -> Response {
    redirecionar(&format!("{}{caminho}", url_app()))
}

fn redirecionar(destino: &str) -> Response {
    let mut r = StatusCode::SEE_OTHER.into_response();
    r.headers_mut().insert(header::LOCATION, HeaderValue::from_str(destino).expect("endereço ascii"));
    r
}

/// Bloqueia a API sem sessão válida e exige um cabeçalho próprio em gravações
/// (outro site não consegue enviá-lo sem permissão de CORS).
pub async fn exigir(State(auth): State<Auth>, req: Request, next: Next) -> Response {
    // Dentro de `nest("/api")` o caminho chega sem o prefixo.
    let caminho = req.uri().path().trim_start_matches("/api");
    let livre = caminho == "/sessao" || caminho == "/saude" || caminho.starts_with("/auth/google");
    let por_token = caminho == "/sincronizar" && req.method() == Method::POST && auth.token_sync_confere(req.headers());
    if !livre && !por_token && !auth.autenticado(req.headers()) {
        return erro(StatusCode::UNAUTHORIZED, "entre para continuar");
    }
    let grava = !matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    if grava && req.headers().get("x-financeiro").is_none() {
        return erro(StatusCode::FORBIDDEN, "requisição sem o cabeçalho do aplicativo");
    }
    next.run(req).await
}

pub async fn estado(State(auth): State<Auth>, headers: HeaderMap) -> Json<Value> {
    let (senha, google) = auth.inner.as_ref().map(|c| (c.senha.is_some(), c.google.is_some())).unwrap_or((false, false));
    Json(json!({
        "exigida": auth.exigida(),
        "autenticado": auth.autenticado(&headers),
        "metodos": { "senha": senha, "google": google },
    }))
}

#[derive(Deserialize)]
pub struct Login {
    usuario: String,
    senha: String,
}

pub async fn entrar(State(auth): State<Auth>, Json(l): Json<Login>) -> Response {
    let Some(c) = auth.inner.clone() else {
        return Json(json!({ "autenticado": true })).into_response();
    };
    let Some(s) = c.senha.as_ref() else {
        return erro(StatusCode::NOT_FOUND, "o login por senha está desligado; entre com o Google");
    };
    {
        let mut t = auth.tentativas.lock().await;
        if let Some(ate) = t.1 {
            if Instant::now() < ate {
                let min = (ate - Instant::now()).as_secs() / 60 + 1;
                return erro(StatusCode::TOO_MANY_REQUESTS, &format!("muitas tentativas erradas; tente de novo em {min} min"));
            }
            *t = (0, None);
        }
    }
    let hash = s.hash.clone();
    let senha = l.senha;
    let senha_ok = tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash).map(|h| Argon2::default().verify_password(senha.as_bytes(), &h).is_ok()).unwrap_or(false)
    })
    .await
    .unwrap_or(false);
    let usuario_ok = l.usuario.trim().eq_ignore_ascii_case(&s.usuario);
    if !(senha_ok && usuario_ok) {
        let mut t = auth.tentativas.lock().await;
        t.0 += 1;
        if t.0 >= MAX_ERROS {
            t.1 = Some(Instant::now() + BLOQUEIO);
            tracing::warn!("login bloqueado por {} min depois de {} erros", BLOQUEIO.as_secs() / 60, t.0);
        }
        return erro(StatusCode::UNAUTHORIZED, "usuário ou senha incorretos");
    }
    *auth.tentativas.lock().await = (0, None);
    let token = Auth::emitir(&c);
    let mut r = Json(json!({ "autenticado": true })).into_response();
    r.headers_mut().insert(header::SET_COOKIE, auth.cookie_header(&token, VALIDADE.as_secs()));
    r
}

pub async fn sair(State(auth): State<Auth>) -> Response {
    let mut r = Json(json!({ "autenticado": false })).into_response();
    r.headers_mut().insert(header::SET_COOKIE, auth.cookie_header("", 0));
    r
}

// ---------- Google ----------

/// Dados guardados no cookie do fluxo entre a ida e a volta do Google.
#[derive(Debug, PartialEq)]
struct Fluxo {
    state: String,
    verificador: String,
    nonce: String,
}

fn selar_fluxo(c: &Config, f: &Fluxo, exp: i64) -> String {
    let carga = format!("{exp}.{}.{}.{}", f.state, f.verificador, f.nonce);
    format!("{carga}.{}", Auth::assinar(c, &format!("{PROPOSITO_FLUXO}{carga}")))
}

fn abrir_fluxo(c: &Config, token: &str, agora: i64) -> Option<Fluxo> {
    let (carga, assinatura) = token.rsplit_once('.')?;
    if !Auth::assinatura_confere(c, &format!("{PROPOSITO_FLUXO}{carga}"), assinatura) {
        return None;
    }
    let mut partes = carga.split('.');
    let exp: i64 = partes.next()?.parse().ok()?;
    let f = Fluxo { state: partes.next()?.into(), verificador: partes.next()?.into(), nonce: partes.next()?.into() };
    (partes.next().is_none() && exp > agora).then_some(f)
}

fn desafio_pkce(verificador: &str) -> String {
    B64.encode(Sha256::digest(verificador.as_bytes()))
}

/// Comparação em tempo constante (para o `state` e o `nonce`).
fn iguais(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// `GET /api/auth/google`: manda para a tela de login do Google.
pub async fn google_iniciar(State(auth): State<Auth>) -> Response {
    let Some(c) = auth.inner.clone() else { return para_o_app("/") };
    let Some(g) = c.google.as_ref() else {
        return para_o_app("/?login=indisponivel");
    };
    let f = Fluxo { state: aleatorio(16), verificador: aleatorio(32), nonce: aleatorio(16) };
    let desafio = desafio_pkce(&f.verificador);
    let url = reqwest::Url::parse_with_params(
        GOOGLE_AUTORIZAR,
        [
            ("client_id", g.client_id.as_str()),
            ("redirect_uri", g.retorno.as_str()),
            ("response_type", "code"),
            ("scope", "openid email"),
            ("state", f.state.as_str()),
            ("nonce", f.nonce.as_str()),
            ("code_challenge", desafio.as_str()),
            ("code_challenge_method", "S256"),
            ("login_hint", g.email.as_str()),
            ("prompt", "select_account"),
        ],
    )
    .expect("URL do Google válida");
    let exp = chrono::Utc::now().timestamp() + VALIDADE_FLUXO.as_secs() as i64;
    let mut r = redirecionar(url.as_str());
    r.headers_mut().insert(header::SET_COOKIE, auth.cookie_fluxo(&selar_fluxo(&c, &f, exp), VALIDADE_FLUXO.as_secs()));
    r
}

#[derive(Deserialize)]
pub struct Retorno {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// `GET /api/auth/google/retorno`: o Google volta para cá com o código de autorização.
/// Em caso de problema, volta para a tela de login com `?login=<motivo>`.
pub async fn google_retorno(State(auth): State<Auth>, headers: HeaderMap, Query(q): Query<Retorno>) -> Response {
    let resultado = concluir_google(&auth, &headers, q).await;
    let Some(c) = auth.inner.as_ref() else { return para_o_app("/") };
    let mut r = match resultado {
        Ok(()) => {
            tracing::info!("login com Google concluído");
            let mut r = para_o_app("/");
            r.headers_mut().append(header::SET_COOKIE, auth.cookie_header(&Auth::emitir(c), VALIDADE.as_secs()));
            r
        }
        Err(motivo) => {
            tracing::warn!("login com Google recusado: {motivo}");
            para_o_app(&format!("/?login={motivo}"))
        }
    };
    // O cookie do fluxo vale para uma tentativa só.
    r.headers_mut().append(header::SET_COOKIE, auth.cookie_fluxo("", 0));
    r
}

async fn concluir_google(auth: &Auth, headers: &HeaderMap, q: Retorno) -> Result<(), &'static str> {
    let c = auth.inner.as_ref().ok_or("indisponivel")?;
    let g = c.google.as_ref().ok_or("indisponivel")?;
    if q.error.is_some() {
        return Err("cancelado");
    }
    let fluxo = cookie(headers, COOKIE_FLUXO)
        .and_then(|t| abrir_fluxo(c, &t, chrono::Utc::now().timestamp()))
        .ok_or("expirado")?;
    if !q.state.as_deref().is_some_and(|s| iguais(s, &fluxo.state)) {
        return Err("expirado");
    }
    let code = q.code.ok_or("falhou")?;

    let resposta = auth
        .http
        .post(GOOGLE_TOKEN)
        .form(&[
            ("code", code.as_str()),
            ("client_id", g.client_id.as_str()),
            ("client_secret", g.client_secret.as_str()),
            ("redirect_uri", g.retorno.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", fluxo.verificador.as_str()),
        ])
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Google (token) não respondeu: {e}");
            "falhou"
        })?;
    if !resposta.status().is_success() {
        // O corpo traz só o código do erro (ex.: invalid_grant, redirect_uri_mismatch), sem segredos.
        let status = resposta.status();
        let corpo = resposta.text().await.unwrap_or_default();
        tracing::error!("Google (token) recusou: {status} {}", corpo.chars().take(300).collect::<String>());
        return Err("falhou");
    }
    let corpo: Value = resposta.json().await.map_err(|_| "falhou")?;
    let id_token = corpo.get("id_token").and_then(Value::as_str).ok_or("falhou")?;
    conferir_id_token(id_token, &g.client_id, &g.email, &fluxo.nonce, chrono::Utc::now().timestamp())
}

/// Confere o ID token recebido do Google.
///
/// A assinatura do token não é verificada: ele chega direto do endpoint de token do Google,
/// por HTTPS e autenticado com o `client_secret`, o que o OpenID Connect aceita como prova de
/// origem (OIDC Core 1.0, seção 3.1.3.7). Conferimos emissor, audiência, validade, `nonce`
/// e o e-mail verificado.
fn conferir_id_token(token: &str, client_id: &str, email: &str, nonce: &str, agora: i64) -> Result<(), &'static str> {
    let carga = token.split('.').nth(1).ok_or("falhou")?;
    let carga = B64.decode(carga.trim_end_matches('=')).map_err(|_| "falhou")?;
    let d: Value = serde_json::from_slice(&carga).map_err(|_| "falhou")?;

    let iss = d.get("iss").and_then(Value::as_str).unwrap_or("");
    if !GOOGLE_EMISSORES.contains(&iss) {
        return Err("falhou");
    }
    let aud_ok = match d.get("aud") {
        Some(Value::String(a)) => a == client_id,
        Some(Value::Array(v)) => v.iter().any(|a| a.as_str() == Some(client_id)),
        _ => false,
    };
    if !aud_ok {
        return Err("falhou");
    }
    // Um minuto de folga para relógios levemente diferentes.
    if d.get("exp").and_then(Value::as_i64).unwrap_or(0) + 60 <= agora {
        return Err("expirado");
    }
    if !d.get("nonce").and_then(Value::as_str).is_some_and(|n| iguais(n, nonce)) {
        return Err("expirado");
    }
    let verificado = match d.get("email_verified") {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => s == "true",
        _ => false,
    };
    let do_token = d.get("email").and_then(Value::as_str).unwrap_or("").to_lowercase();
    if !verificado || do_token != email {
        return Err("negado");
    }
    Ok(())
}

#[cfg(test)]
mod testes {

    #[test]
    fn endereco_do_app_valido() {
        assert_eq!(app_valida(" https://app.seudominio.com.br/ "), "https://app.seudominio.com.br");
        assert_eq!(app_valida("http://127.0.0.1:5173"), "http://127.0.0.1:5173");
        assert_eq!(app_valida("http://app.exemplo.com"), "");
        assert_eq!(app_valida("https://app.exemplo.com/caminho"), "");
        assert_eq!(app_valida(""), "");
    }

    use super::*;

    fn config(google: bool) -> Config {
        Config {
            senha: Some(Senha { usuario: "eu".into(), hash: gerar_hash("senha-de-teste-123").unwrap() }),
            google: google.then(|| Google {
                client_id: "cliente.apps.googleusercontent.com".into(),
                client_secret: "segredo".into(),
                email: "eu@gmail.com".into(),
                retorno: "http://127.0.0.1:8080/api/auth/google/retorno".into(),
            }),
            segredo: vec![7; 32],
            cookie_seguro: true,
            token_sync: Some("t".repeat(40)),
        }
    }

    fn auth() -> Auth {
        Auth { inner: Some(Arc::new(config(true))), tentativas: Default::default(), http: reqwest::Client::new() }
    }

    fn id_token(d: Value) -> String {
        format!("{}.{}.assinatura", B64.encode(br#"{"alg":"RS256"}"#), B64.encode(d.to_string()))
    }

    fn dados_validos() -> Value {
        json!({
            "iss": "https://accounts.google.com",
            "aud": "cliente.apps.googleusercontent.com",
            "exp": 2_000_000_000i64,
            "nonce": "n123",
            "email": "Eu@Gmail.com",
            "email_verified": true,
        })
    }

    #[test]
    fn token_assinado_e_validado() {
        let a = auth();
        let t = Auth::emitir(a.inner.as_ref().unwrap());
        assert!(a.valido(&t));
        // Alterar a validade invalida a assinatura.
        let (carga, ass) = t.rsplit_once('.').unwrap();
        let (_, nonce) = carga.split_once('.').unwrap();
        assert!(!a.valido(&format!("99999999999.{nonce}.{ass}")));
        assert!(!a.valido("lixo"));
    }

    #[test]
    fn le_cookie_entre_varios() {
        let mut h = HeaderMap::new();
        h.insert(header::COOKIE, HeaderValue::from_static("a=1; sessao=abc.def; b=2"));
        assert_eq!(cookie(&h, "sessao").as_deref(), Some("abc.def"));
    }

    #[test]
    fn cookie_de_sessao_e_lax() {
        let v = auth().cookie_header("x", 10);
        let s = v.to_str().unwrap();
        assert!(s.contains("SameSite=Lax") && s.contains("HttpOnly") && s.contains("Secure"));
    }

    #[test]
    fn fluxo_ida_e_volta() {
        let c = config(true);
        let f = Fluxo { state: aleatorio(16), verificador: aleatorio(32), nonce: aleatorio(16) };
        let selado = selar_fluxo(&c, &f, 1_000);
        assert_eq!(abrir_fluxo(&c, &selado, 999), Some(f));
        // Vencido.
        assert!(abrir_fluxo(&c, &selado, 1_000).is_none());
        // Adulterado.
        let mexido = selado.replacen("1000", "9999", 1);
        assert!(abrir_fluxo(&c, &mexido, 999).is_none());
    }

    #[test]
    fn cookie_do_fluxo_nao_vale_como_sessao() {
        let a = auth();
        let c = a.inner.as_ref().unwrap();
        let f = Fluxo { state: "s".into(), verificador: "v".into(), nonce: "n".into() };
        let selado = selar_fluxo(c, &f, chrono::Utc::now().timestamp() + 600);
        assert!(!a.valido(&selado));
        // E a sessão não vale como fluxo.
        assert!(abrir_fluxo(c, &Auth::emitir(c), 0).is_none());
    }

    #[test]
    fn pkce_s256_do_rfc7636() {
        // Exemplo do apêndice B do RFC 7636.
        assert_eq!(desafio_pkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn id_token_valido_passa() {
        let t = id_token(dados_validos());
        assert_eq!(conferir_id_token(&t, "cliente.apps.googleusercontent.com", "eu@gmail.com", "n123", 1_900_000_000), Ok(()));
    }

    #[test]
    fn id_token_recusado() {
        let conferir = |mudar: &dyn Fn(&mut Value)| {
            let mut d = dados_validos();
            mudar(&mut d);
            conferir_id_token(&id_token(d), "cliente.apps.googleusercontent.com", "eu@gmail.com", "n123", 1_900_000_000)
        };
        assert_eq!(conferir(&|d| d["email"] = json!("outra@gmail.com")), Err("negado"));
        assert_eq!(conferir(&|d| d["email_verified"] = json!(false)), Err("negado"));
        assert_eq!(conferir(&|d| d["aud"] = json!("outro-app")), Err("falhou"));
        assert_eq!(conferir(&|d| d["iss"] = json!("https://falso.example")), Err("falhou"));
        assert_eq!(conferir(&|d| d["nonce"] = json!("outro")), Err("expirado"));
        assert_eq!(conferir(&|d| d["exp"] = json!(1_000)), Err("expirado"));
        assert_eq!(conferir_id_token("lixo", "c", "e", "n", 0), Err("falhou"));
    }

    #[test]
    fn token_da_sincronizacao() {
        let a = auth();
        let mut h = HeaderMap::new();
        assert!(!a.token_sync_confere(&h));
        h.insert(header::AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", "t".repeat(40))).unwrap());
        assert!(a.token_sync_confere(&h));
        h.insert(header::AUTHORIZATION, HeaderValue::from_static("Bearer errado"));
        assert!(!a.token_sync_confere(&h));
    }

    #[test]
    fn comparacao_constante() {
        assert!(iguais("abc", "abc"));
        assert!(!iguais("abc", "abd"));
        assert!(!iguais("abc", "ab"));
    }
}
