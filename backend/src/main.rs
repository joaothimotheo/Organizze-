//! Financeiro · API
//!
//! Variáveis de ambiente (detalhes no README):
//! - `DATABASE_URL`: Postgres (ex.: Neon). Ausente = arquivos JSON em `FINANCEIRO_DADOS`.
//! - `FINANCEIRO_DADOS`: pasta com os JSON (padrão `dados`)
//! - `FINANCEIRO_ENDERECO`: endereço de escuta (padrão `127.0.0.1:8080`; `PORT` também é aceito)
//! - `FINANCEIRO_FRONTEND`: pasta do front-end compilado (padrão `frontend/dist`)
//! - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FINANCEIRO_EMAIL`: login com Google
//! - `FINANCEIRO_USUARIO`, `FINANCEIRO_SENHA`: login por senha (opcional com o Google)
//! - `FINANCEIRO_SEGREDO`: chave das sessões. Algum login é obrigatório fora da máquina local.

mod armazenamento;
mod arquivo_env;
mod auth;
mod bcb;
mod calculos;
mod categorias;
mod dividas;
mod fixas;
mod fonte;
mod metas;
mod emprestimos;
mod importar;
mod lancamentos;
mod manuais;
mod modelo;
mod pdf;
mod pluggy;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::{DefaultBodyLimit, FromRef, Multipart, Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Datelike, FixedOffset, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use armazenamento::{arquivo_valido, Armazenamento, ARQUIVOS};
use auth::Auth;

/// Uma análise de documento aguardando sua revisão (fica só na memória por 1 hora).
struct Pendente {
    previa: importar::Previa,
    bytes: Vec<u8>,
    criado: Instant,
}

#[derive(Clone)]
struct App {
    arm: Armazenamento,
    http: reqwest::Client,
    /// Serializa gravações para não perder alterações concorrentes.
    escrita: Arc<Mutex<()>>,
    auth: Auth,
    pendentes: Arc<Mutex<HashMap<String, Pendente>>>,
    /// Sincronização com a Pluggy (ausente sem `PLUGGY_CLIENT_ID`).
    pluggy: Option<pluggy::Pluggy>,
}

impl FromRef<App> for Auth {
    fn from_ref(app: &App) -> Auth {
        app.auth.clone()
    }
}

struct Erro(StatusCode, String);

impl IntoResponse for Erro {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "erro": self.1 }))).into_response()
    }
}

impl From<anyhow::Error> for Erro {
    fn from(e: anyhow::Error) -> Self {
        Erro(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}"))
    }
}

fn pedido_invalido(msg: impl Into<String>) -> Erro {
    Erro(StatusCode::BAD_REQUEST, msg.into())
}

type Res<T> = Result<Json<T>, Erro>;

/// Horário de Brasília (sem horário de verão desde 2019).
fn agora() -> DateTime<FixedOffset> {
    Utc::now().with_timezone(&FixedOffset::west_opt(3 * 3600).unwrap())
}

fn agora_txt() -> String {
    agora().to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

#[derive(Deserialize)]
struct FiltroPeriodo {
    ano: Option<i32>,
    /// 1..12; ausente ou 0 = ano inteiro
    mes: Option<u32>,
    /// `documentos` = modelo antigo, sem o que veio do banco.
    fonte: Option<String>,
}

async fn saude(State(app): State<App>) -> Json<Value> {
    Json(json!({ "ok": true, "armazenamento": app.arm.descricao(), "login": app.auth.exigida() }))
}

async fn visao_geral(State(app): State<App>, Query(f): Query<FiltroPeriodo>) -> Res<calculos::VisaoGeral> {
    let dados = if f.fonte.as_deref() == Some("documentos") { app.arm.carregar_documentos().await? } else { app.arm.carregar().await? };
    let hoje = agora().date_naive();
    let ano = f.ano.unwrap_or(hoje.year());
    let mes = match f.mes {
        Some(m @ 1..=12) => Some(m),
        Some(0) | None => None,
        Some(_) => return Err(pedido_invalido("mês deve estar entre 1 e 12")),
    };
    Ok(Json(calculos::visao_geral(&dados, ano, mes, hoje)))
}

async fn fontes(State(app): State<App>) -> Json<Vec<armazenamento::Fonte>> {
    Json(app.arm.fontes().await)
}

#[derive(Deserialize, Default)]
struct FiltroFonte {
    /// `documentos` = só o que veio de holerites, faturas e extratos (sem o banco).
    fonte: Option<String>,
}

async fn arquivo(State(app): State<App>, Path(nome): Path<String>, Query(f): Query<FiltroFonte>) -> Res<Value> {
    let nome = nome.trim_end_matches(".json");
    if !arquivo_valido(nome) {
        return Err(Erro(StatusCode::NOT_FOUND, format!("arquivo desconhecido: {nome}")));
    }
    let mut v = app.arm.ler_json(nome).await?;
    if f.fonte.as_deref() == Some("documentos") {
        fonte::so_documentos(nome, &mut v);
    }
    Ok(Json(v))
}

async fn atualizar_indicadores(State(app): State<App>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut doc = app.arm.ler_json("indicadores").await?;
    let agora = agora_txt();
    let res = bcb::atualizar(&app.http, &mut doc, &agora).await;
    let alguma_ok = res.iter().any(|r| r.ok);
    if alguma_ok {
        app.arm.gravar_valor("indicadores", &doc).await?;
    }
    Ok(Json(json!({ "gravado": alguma_ok, "consultado_em": agora, "series": res })))
}

// ---------- importação de documentos ----------

async fn analisar_documento(State(app): State<App>, mut mp: Multipart) -> Res<importar::Previa> {
    let mut arquivo: Option<(String, Vec<u8>)> = None;
    while let Some(campo) = mp.next_field().await.map_err(|e| pedido_invalido(format!("envio incompleto: {e}")))? {
        if campo.name() == Some("arquivo") {
            let nome = campo.file_name().unwrap_or("documento").to_string();
            let bytes = campo.bytes().await.map_err(|e| pedido_invalido(format!("envio incompleto: {e}")))?;
            arquivo = Some((nome, bytes.to_vec()));
        }
    }
    let Some((nome, bytes)) = arquivo else { return Err(pedido_invalido("nenhum arquivo enviado")) };
    if bytes.is_empty() {
        return Err(pedido_invalido("o arquivo está vazio"));
    }
    // Só o nome do arquivo, sem pastas.
    let nome = nome.rsplit(['/', '\\']).next().unwrap_or("documento").to_string();
    let mut id = [0u8; 12];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut id);
    let id = hex::encode(id);
    let previa = importar::analisar(&app.arm, id.clone(), &nome, &bytes).await.map_err(|e| Erro(StatusCode::UNPROCESSABLE_ENTITY, format!("{e:#}")))?;
    let mut p = app.pendentes.lock().await;
    p.retain(|_, v| v.criado.elapsed() < Duration::from_secs(3600));
    p.insert(id, Pendente { previa: previa.clone(), bytes, criado: Instant::now() });
    Ok(Json(previa))
}

async fn confirmar_documento(State(app): State<App>, Path(id): Path<String>, Json(ajustes): Json<importar::Ajustes>) -> Res<importar::Resultado> {
    let pendente = app.pendentes.lock().await.remove(&id);
    let Some(p) = pendente else {
        return Err(Erro(StatusCode::NOT_FOUND, "esta análise expirou; envie o arquivo de novo".into()));
    };
    let _trava = app.escrita.lock().await;
    match importar::aplicar(&app.arm, &p.previa, &p.bytes, &ajustes, &agora_txt()).await {
        Ok(r) => Ok(Json(r)),
        Err(e) => Err(Erro(StatusCode::CONFLICT, format!("{e:#}"))),
    }
}

async fn descartar_documento(State(app): State<App>, Path(id): Path<String>) -> Json<Value> {
    let removido = app.pendentes.lock().await.remove(&id).is_some();
    Json(json!({ "removido": removido }))
}

async fn baixar_original(State(app): State<App>, Path(sha): Path<String>) -> Result<Response, Erro> {
    let Some((nome, tipo, bytes)) = app.arm.ler_original(&sha).await? else {
        return Err(Erro(StatusCode::NOT_FOUND, "documento original não encontrado".into()));
    };
    let nome_seguro: String = nome.chars().filter(|c| c.is_ascii_alphanumeric() || "._-".contains(*c)).collect();
    let mut r = bytes.into_response();
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(if tipo.is_empty() { "application/octet-stream" } else { &tipo }).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_str(&format!("inline; filename=\"{nome_seguro}\"")).unwrap());
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    Ok(r)
}

// ---------- dívidas informadas por você ----------

#[derive(Deserialize)]
struct NovaDivida {
    nome: String,
    credor: Option<String>,
    tipo: Option<String>,
    valor_atual: f64,
    data_referencia: String,
    valor_original: Option<f64>,
    vencimento_original: Option<String>,
    parcelas_restantes: Option<u32>,
    /// Total de parcelas do contrato (para mostrar "parcela 4/19").
    #[serde(default)]
    parcelas_total: Option<u32>,
    valor_parcela: Option<f64>,
    proximo_vencimento: Option<String>,
    taxa_mensal: Option<f64>,
    obs: Option<String>,
}

fn data_iso_valida(s: &str) -> bool {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

fn validar_divida(d: &NovaDivida) -> Result<(), Erro> {
    if d.nome.trim().is_empty() {
        return Err(pedido_invalido("dê um nome para a dívida"));
    }
    if !d.valor_atual.is_finite() || d.valor_atual < 0.0 {
        return Err(pedido_invalido("valor atual inválido"));
    }
    for (rotulo, v) in [("data de referência", Some(&d.data_referencia)), ("vencimento original", d.vencimento_original.as_ref()), ("próximo vencimento", d.proximo_vencimento.as_ref())] {
        if let Some(v) = v {
            if !v.is_empty() && !data_iso_valida(v) {
                return Err(pedido_invalido(format!("{rotulo} inválida")));
            }
        }
    }
    if !data_iso_valida(&d.data_referencia) {
        return Err(pedido_invalido("informe a data de referência do valor"));
    }
    if let (Some(t), Some(r)) = (d.parcelas_total, d.parcelas_restantes) {
        if t < r {
            return Err(pedido_invalido("o total de parcelas não pode ser menor que as parcelas restantes"));
        }
    }
    Ok(())
}

fn vazio_para_nulo(s: &Option<String>) -> Value {
    match s.as_deref().map(str::trim) {
        Some(x) if !x.is_empty() => json!(x),
        _ => Value::Null,
    }
}

/// Com parcelas, quitada só quando acabam (o saldo estimado pode zerar antes da última); sem
/// parcelas, quando você informa saldo zero.
fn situacao_informada(d: &NovaDivida) -> &'static str {
    let quitada = match d.parcelas_restantes {
        Some(p) => p == 0,
        None => d.valor_atual == 0.0,
    };
    if quitada {
        "quitada"
    } else {
        "ativa"
    }
}

/// O saldo do formulário é o do último saldo registrado (mesma data e mesmo valor)?
fn mesmo_ultimo_saldo(alvo: &Value, d: &NovaDivida) -> Option<bool> {
    let s = dividas::ultimo_registro_saldo(alvo)?;
    Some(s["data"].as_str() == Some(d.data_referencia.as_str()) && s["saldo_devedor"].as_f64().is_some_and(|v| (v - importar::r2(d.valor_atual)).abs() < 0.005))
}

fn aplicar_campos(alvo: &mut Value, d: &NovaDivida, agora: &str) {
    alvo["nome"] = json!(d.nome.trim());
    alvo["credor"] = json!(d.credor.as_deref().map(str::trim).filter(|x| !x.is_empty()).unwrap_or(d.nome.trim()));
    alvo["tipo"] = vazio_para_nulo(&d.tipo);
    alvo["valor_contratado"] = json!(d.valor_original);
    alvo["vencimento_original"] = vazio_para_nulo(&d.vencimento_original);
    alvo["parcelas_restantes"] = json!(d.parcelas_restantes);
    alvo["parcelas_total"] = json!(d.parcelas_total.filter(|_| d.parcelas_restantes.is_some()));
    alvo["parcela_valor"] = json!(d.valor_parcela);
    alvo["proximo_vencimento"] = vazio_para_nulo(&d.proximo_vencimento);
    alvo["taxa_mensal"] = json!(d.taxa_mensal);
    alvo["obs"] = vazio_para_nulo(&d.obs);
    // O formulário vem com o último saldo: se ele é o estimado de um lançamento e não mudou,
    // continua sendo do lançamento (desligar o lançamento ainda o tira).
    let saldo_do_lancamento = mesmo_ultimo_saldo(alvo, d) == Some(true) && dividas::ultimo_registro_saldo(alvo).is_some_and(|s| s["origem"]["tipo"] == "lancamento");
    alvo["situacao"] = json!(situacao_informada(d));
    alvo["origem"] = json!({ "tipo": "informado" });
    alvo["informado_em"] = json!(agora);
    if !alvo.get("saldos").is_some_and(Value::is_array) {
        alvo["saldos"] = json!([]);
    }
    if saldo_do_lancamento {
        return;
    }
    let saldos = alvo["saldos"].as_array_mut().unwrap();
    saldos.retain(|s| s["data"].as_str() != Some(d.data_referencia.as_str()) || s["origem"]["tipo"] == "lancamento");
    saldos.push(json!({ "data": d.data_referencia, "saldo_devedor": importar::r2(d.valor_atual), "status": "estimado", "origem": { "tipo": "informado" } }));
    saldos.sort_by(|a, b| a["data"].as_str().cmp(&b["data"].as_str()));
}

/// A edição muda algo que os pagamentos mexem (parcelas, vencimento, situação ou o saldo)?
/// Nome, tipo, taxa, credor e observação não contam.
fn edicao_mexe_nos_pagamentos(alvo: &Value, d: &NovaDivida) -> bool {
    json!(d.parcelas_restantes) != alvo["parcelas_restantes"]
        || vazio_para_nulo(&d.proximo_vencimento) != alvo["proximo_vencimento"]
        || json!(situacao_informada(d)) != alvo["situacao"]
        || mesmo_ultimo_saldo(alvo, d) != Some(true)
}

/// Edita uma dívida informada por você.
fn editar_campos(alvo: &mut Value, d: &NovaDivida, agora: &str) {
    let mexe = edicao_mexe_nos_pagamentos(alvo, d);
    aplicar_campos(alvo, d, agora);
    // O que você escreveu vale: desfazer um pagamento anterior não mexe mais nesses campos.
    if mexe {
        dividas::marcar_editada(alvo);
    }
}

fn lista_dividas(dv: &mut Value) -> &mut Vec<Value> {
    if !dv.is_object() {
        *dv = json!({ "schema_version": 1 });
    }
    if !dv.get("dividas").is_some_and(Value::is_array) {
        dv["dividas"] = json!([]);
    }
    dv["dividas"].as_array_mut().unwrap()
}

fn informada(d: &Value) -> bool {
    d["origem"]["tipo"].as_str() == Some("informado")
}

async fn criar_divida(State(app): State<App>, Json(d): Json<NovaDivida>) -> Res<Value> {
    validar_divida(&d)?;
    let _trava = app.escrita.lock().await;
    let agora = agora_txt();
    let mut dv = app.arm.ler_json("dividas").await?;
    let slug: String = d.nome.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let slug = slug.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    let mut sufixo = [0u8; 3];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut sufixo);
    let mut nova = json!({ "id": format!("informada-{}-{}", if slug.is_empty() { "divida" } else { &slug }, hex::encode(sufixo)) });
    aplicar_campos(&mut nova, &d, &agora);
    lista_dividas(&mut dv).push(nova.clone());
    dv["atualizado_em"] = json!(agora);
    app.arm.gravar_valor("dividas", &dv).await?;
    Ok(Json(nova))
}

async fn editar_divida(State(app): State<App>, Path(id): Path<String>, Json(d): Json<NovaDivida>) -> Res<Value> {
    validar_divida(&d)?;
    let _trava = app.escrita.lock().await;
    let agora = agora_txt();
    let mut dv = app.arm.ler_json("dividas").await?;
    let l = lista_dividas(&mut dv);
    let Some(alvo) = l.iter_mut().find(|x| x["id"].as_str() == Some(id.as_str())) else {
        return Err(Erro(StatusCode::NOT_FOUND, "dívida não encontrada".into()));
    };
    if !informada(alvo) {
        return Err(Erro(StatusCode::FORBIDDEN, "esta dívida vem de um documento e é atualizada pela importação".into()));
    }
    editar_campos(alvo, &d, &agora);
    let r = alvo.clone();
    dv["atualizado_em"] = json!(agora);
    app.arm.gravar_valor("dividas", &dv).await?;
    Ok(Json(r))
}

async fn excluir_divida(State(app): State<App>, Path(id): Path<String>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut dv = app.arm.ler_json("dividas").await?;
    let l = lista_dividas(&mut dv);
    let antes = l.len();
    let mut protegida = false;
    l.retain(|x| {
        if x["id"].as_str() != Some(id.as_str()) {
            return true;
        }
        protegida = !informada(x);
        protegida
    });
    if protegida {
        return Err(Erro(StatusCode::FORBIDDEN, "esta dívida vem de um documento e não pode ser excluída aqui".into()));
    }
    if l.len() == antes {
        return Err(Erro(StatusCode::NOT_FOUND, "dívida não encontrada".into()));
    }
    dv["atualizado_em"] = json!(agora_txt());
    app.arm.gravar_valor("dividas", &dv).await?;
    Ok(Json(json!({ "excluida": id })))
}

#[derive(Deserialize)]
struct NovoTipo {
    nome: String,
}

async fn criar_tipo_divida(State(app): State<App>, Json(t): Json<NovoTipo>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut dv = app.arm.ler_json("dividas").await?;
    let tipo = dividas::criar_tipo(&mut dv, &t.nome, &agora_txt())?;
    app.arm.gravar_valor("dividas", &dv).await?;
    Ok(Json(tipo))
}

async fn apagar_tipo_divida(State(app): State<App>, Path(id): Path<String>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut dv = app.arm.ler_json("dividas").await?;
    let movidas = dividas::apagar_tipo(&mut dv, &id, &agora_txt())?;
    app.arm.gravar_valor("dividas", &dv).await?;
    Ok(Json(json!({ "movidas": movidas })))
}

#[derive(Deserialize)]
struct Recusa {
    lancamento_id: String,
}

/// "Não é desta dívida": a sugestão de ligar o lançamento a ela não aparece mais.
async fn recusar_sugestao_divida(State(app): State<App>, Path(id): Path<String>, Json(r): Json<Recusa>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut dv = app.arm.ler_json("dividas").await?;
    dividas::recusar(&mut dv, &id, r.lancamento_id.trim())?;
    dv["atualizado_em"] = json!(agora_txt());
    app.arm.gravar_valor("dividas", &dv).await?;
    Ok(Json(json!({ "ok": true })))
}

// ---------- empréstimos entre pessoas ----------

impl From<emprestimos::Falha> for Erro {
    fn from(f: emprestimos::Falha) -> Self {
        match f {
            emprestimos::Falha::Invalido(m) => pedido_invalido(m),
            emprestimos::Falha::NaoEncontrado(m) => Erro(StatusCode::NOT_FOUND, m.into()),
            emprestimos::Falha::Conflito(m) => Erro(StatusCode::CONFLICT, m),
        }
    }
}

fn id_aleatorio(prefixo: &str) -> String {
    let mut b = [0u8; 6];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut b);
    format!("{prefixo}-{}", hex::encode(b))
}

async fn criar_emprestimo(State(app): State<App>, Json(e): Json<emprestimos::NovoEmprestimo>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("emprestimos").await?;
    let r = emprestimos::criar(&mut arq, &e, id_aleatorio("emprestimo"), &agora_txt())?;
    app.arm.gravar_valor("emprestimos", &arq).await?;
    Ok(Json(r))
}

async fn editar_emprestimo(State(app): State<App>, Path(id): Path<String>, Json(e): Json<emprestimos::NovoEmprestimo>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("emprestimos").await?;
    let r = emprestimos::editar(&mut arq, &id, &e, &agora_txt())?;
    app.arm.gravar_valor("emprestimos", &arq).await?;
    Ok(Json(r))
}

async fn excluir_emprestimo(State(app): State<App>, Path(id): Path<String>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("emprestimos").await?;
    emprestimos::excluir(&mut arq, &id, &agora_txt())?;
    app.arm.gravar_valor("emprestimos", &arq).await?;
    Ok(Json(json!({ "excluido": id })))
}

async fn pagar_emprestimo(State(app): State<App>, Path(id): Path<String>, Json(p): Json<emprestimos::NovoPagamento>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("emprestimos").await?;
    let r = emprestimos::pagar(&mut arq, &id, &p, id_aleatorio("pagamento"), &agora_txt())?;
    app.arm.gravar_valor("emprestimos", &arq).await?;
    Ok(Json(r))
}

async fn desfazer_pagamento(State(app): State<App>, Path((id, pid)): Path<(String, String)>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("emprestimos").await?;
    let r = emprestimos::remover_pagamento(&mut arq, &id, &pid, &agora_txt())?;
    app.arm.gravar_valor("emprestimos", &arq).await?;
    Ok(Json(r))
}

// ---------- metas ----------

async fn criar_meta(State(app): State<App>, Json(m): Json<metas::NovaMeta>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("metas").await?;
    let r = metas::criar(&mut arq, &m, id_aleatorio("meta"), &agora_txt())?;
    app.arm.gravar_valor("metas", &arq).await?;
    Ok(Json(r))
}

async fn editar_meta(State(app): State<App>, Path(id): Path<String>, Json(m): Json<metas::NovaMeta>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("metas").await?;
    let r = metas::editar(&mut arq, &id, &m, &agora_txt())?;
    app.arm.gravar_valor("metas", &arq).await?;
    Ok(Json(r))
}

async fn excluir_meta(State(app): State<App>, Path(id): Path<String>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("metas").await?;
    metas::excluir(&mut arq, &id, &agora_txt())?;
    app.arm.gravar_valor("metas", &arq).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct ValorGuardado {
    valor: f64,
}

async fn guardar_na_meta(State(app): State<App>, Path(id): Path<String>, Json(v): Json<ValorGuardado>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("metas").await?;
    let r = metas::guardar(&mut arq, &id, v.valor, &agora_txt())?;
    app.arm.gravar_valor("metas", &arq).await?;
    Ok(Json(r))
}

// ---------- lançamento manual ----------

async fn criar_lancamento(State(app): State<App>, Json(n): Json<manuais::NovoLancamento>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("movimentacoes").await?;
    let r = manuais::criar(&mut arq, &n, id_aleatorio("manual"), &agora_txt())?;
    arq["atualizado_em"] = json!(agora_txt());
    app.arm.gravar_valor("movimentacoes", &arq).await?;
    Ok(Json(r))
}

async fn apagar_lancamento(State(app): State<App>, Path(id): Path<String>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("movimentacoes").await?;
    let antes = arq["movimentacoes"].as_array().and_then(|l| l.iter().find(|m| m["id"].as_str() == Some(id.as_str()))).cloned();
    manuais::apagar(&mut arq, &id)?;
    // Ligado a uma pessoa, fixa ou dívida: desfaz o pagamento / a marca antes de apagar.
    let agora = agora_txt();
    if let Some(m) = antes.filter(|m| m["vinculo"].is_object()) {
        let tipo = m["vinculo"]["tipo"].as_str().unwrap_or("");
        let cats = app.arm.ler_json("categorias").await?;
        let mut a = ler_para_efeitos(&app, tipo == "fixa", tipo == "pessoa", tipo == "divida").await?;
        let outros = arq["movimentacoes"].as_array().cloned().unwrap_or_default();
        lancamentos::desfazer_vinculo(&m, &cats, &outros, &mut a.fixas, &mut a.emprestimos, &mut a.dividas, &agora)?;
        gravar_efeitos(&app, &a).await?;
    }
    arq["atualizado_em"] = json!(agora);
    app.arm.gravar_valor("movimentacoes", &arq).await?;
    Ok(Json(json!({ "apagado": id })))
}

// ---------- contas fixas ----------

async fn criar_fixa(State(app): State<App>, Json(f): Json<fixas::NovaFixa>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("fixas").await?;
    let r = fixas::criar(&mut arq, &f, id_aleatorio("fixa"), &agora_txt())?;
    app.arm.gravar_valor("fixas", &arq).await?;
    Ok(Json(r))
}

async fn editar_fixa(State(app): State<App>, Path(id): Path<String>, Json(f): Json<fixas::NovaFixa>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("fixas").await?;
    let r = fixas::editar(&mut arq, &id, &f, &agora_txt())?;
    app.arm.gravar_valor("fixas", &arq).await?;
    Ok(Json(r))
}

async fn excluir_fixa(State(app): State<App>, Path(id): Path<String>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("fixas").await?;
    fixas::excluir(&mut arq, &id, &agora_txt())?;
    app.arm.gravar_valor("fixas", &arq).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct SugestaoIgnorada {
    chave: String,
    ignorar: bool,
}

async fn ignorar_sugestao(State(app): State<App>, Json(s): Json<SugestaoIgnorada>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("fixas").await?;
    let l = fixas::ignorar(&mut arq, &s.chave, s.ignorar, &agora_txt())?;
    app.arm.gravar_valor("fixas", &arq).await?;
    Ok(Json(json!({ "ignoradas": l })))
}

#[derive(Deserialize)]
struct MarcaPago {
    mes: String,
    pago: bool,
}

async fn marcar_fixa_paga(State(app): State<App>, Path(id): Path<String>, Json(p): Json<MarcaPago>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("fixas").await?;
    let r = fixas::marcar_pago(&mut arq, &id, &p.mes, p.pago, &agora_txt())?;
    app.arm.gravar_valor("fixas", &arq).await?;
    Ok(Json(r))
}

// ---------- contas ----------

#[derive(Deserialize)]
struct PapelConta {
    /// `reserva` (reserva de emergência, à parte do dia a dia) ou vazio (conta do dia a dia).
    papel: Option<String>,
}

async fn mudar_papel_conta(State(app): State<App>, Path(id): Path<String>, Json(p): Json<PapelConta>) -> Res<Value> {
    let papel = match p.papel.as_deref().map(str::trim) {
        None | Some("") | Some("dia_a_dia") => Value::Null,
        Some("reserva") => json!("reserva"),
        Some(_) => return Err(pedido_invalido("papel deve ser reserva ou dia_a_dia")),
    };
    let _trava = app.escrita.lock().await;
    let mut cfg = app.arm.ler_json("config").await?;
    let Some(c) = cfg["contas"].as_array_mut().and_then(|l| l.iter_mut().find(|c| c["id"].as_str() == Some(id.as_str()))) else {
        return Err(Erro(StatusCode::NOT_FOUND, "conta não encontrada".into()));
    };
    if !c["tipo"].as_str().is_some_and(|t| t.contains("corrente")) {
        return Err(pedido_invalido("só conta corrente pode ser reserva"));
    }
    c["papel"] = papel;
    let c = c.clone();
    cfg["atualizado_em"] = json!(agora_txt());
    app.arm.gravar_valor("config", &cfg).await?;
    Ok(Json(c))
}

// ---------- reclassificar lançamentos ----------

/// Naturezas que você pode escolher para um lançamento.
const NATUREZAS: [&str; 10] = [
    "receita",
    "despesa",
    "estorno",
    "transferencia_interna",
    "aporte_investimento",
    "resgate_investimento",
    "pagamento_divida",
    "emprestimo_recebido",
    "emprestimo_concedido",
    "emprestimo_devolvido",
];
const TAMANHO_QUEM: usize = 60;

#[derive(Deserialize)]
struct NovaCategoria {
    /// Ausente = não mexe na categoria (por exemplo, quando só o nome muda).
    #[serde(default)]
    categoria: Option<String>,
    /// Detalhe do grupo, só junto com `categoria` (vale também para os de mesma descrição).
    /// Ausente ou vazio limpa o detalhe.
    #[serde(default)]
    subcategoria: Option<String>,
    /// Aplicar também aos outros lançamentos com a mesma descrição ainda sem categoria.
    #[serde(default)]
    mesma_descricao: bool,
    /// O que é este lançamento, escrito por você ("Pix do Thiago: metade do aluguel"). Vazio apaga.
    #[serde(default)]
    nome: Option<String>,
    /// Muda o tipo só deste lançamento (uma de `NATUREZAS`).
    #[serde(default)]
    natureza: Option<String>,
    /// Quem mandou (entrada) ou para quem foi (gasto). Vazio apaga.
    #[serde(default)]
    quem: Option<String>,
    /// Dividir entre grupos: `[{valor, categoria, subcategoria?}]`; `null` volta a uma categoria só.
    #[serde(default, deserialize_with = "presente")]
    partes: Option<Option<Vec<Value>>>,
    /// Ligar a uma dívida, pessoa ou conta fixa: `{tipo, id}`; `null` desliga.
    #[serde(default, deserialize_with = "presente")]
    vinculo: Option<Option<lancamentos::Vinculo>>,
}

/// Distingue campo ausente (`None`) de `null` (`Some(None)`).
fn presente<'de, T: Deserialize<'de>, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(d).map(Some)
}

/// Grava um texto opcional do lançamento; vazio apaga o campo.
fn texto_ou_remove(m: &mut Value, campo: &str, texto: &str) {
    let t = texto.trim();
    if t.is_empty() {
        if let Some(o) = m.as_object_mut() {
            o.remove(campo);
        }
    } else {
        m[campo] = json!(t);
    }
}

/// Arquivos que os efeitos de um lançamento mexem: `fixas`, `emprestimos` e `dividas`; os que
/// não precisam ficam null.
struct ArquivosDeEfeitos {
    fixas: Value,
    emprestimos: Value,
    dividas: Value,
}

/// Lê só os arquivos que os efeitos de um lançamento precisam.
async fn ler_para_efeitos(app: &App, fixas: bool, emprestimos: bool, dividas: bool) -> Result<ArquivosDeEfeitos, Erro> {
    let ler = |nome: &'static str, precisa: bool| async move { if precisa { app.arm.ler_json(nome).await } else { Ok(Value::Null) } };
    Ok(ArquivosDeEfeitos { fixas: ler("fixas", fixas).await?, emprestimos: ler("emprestimos", emprestimos).await?, dividas: ler("dividas", dividas).await? })
}

/// Grava os arquivos que foram lidos para os efeitos (antes de `movimentacoes`).
async fn gravar_efeitos(app: &App, a: &ArquivosDeEfeitos) -> Result<(), Erro> {
    for (nome, v) in [("fixas", &a.fixas), ("emprestimos", &a.emprestimos), ("dividas", &a.dividas)] {
        if !v.is_null() {
            app.arm.gravar_valor(nome, v).await?;
        }
    }
    Ok(())
}

async fn reclassificar(State(app): State<App>, Path(id): Path<String>, Json(n): Json<NovaCategoria>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    if n.categoria.is_none() && n.nome.is_none() && n.natureza.is_none() && n.quem.is_none() && n.partes.is_none() && n.vinculo.is_none() {
        return Err(pedido_invalido("informe a categoria, o nome, a natureza, quem, as partes ou o vínculo"));
    }
    if n.nome.as_deref().is_some_and(|x| x.trim().chars().count() > 120) {
        return Err(pedido_invalido("o nome pode ter até 120 letras"));
    }
    if n.quem.as_deref().is_some_and(|x| x.trim().chars().count() > TAMANHO_QUEM) {
        return Err(pedido_invalido(format!("quem pode ter até {TAMANHO_QUEM} letras")));
    }
    if n.natureza.as_deref().is_some_and(|x| !NATUREZAS.contains(&x)) {
        return Err(pedido_invalido("natureza desconhecida"));
    }
    if n.subcategoria.is_some() && n.categoria.is_none() {
        return Err(pedido_invalido("informe a categoria junto com o detalhe"));
    }
    let detalhe = lancamentos::detalhe_escrito(n.subcategoria.as_deref().unwrap_or(""))?;
    let cats = app.arm.ler_json("categorias").await?;
    if n.categoria.as_deref().is_some_and(|c| !categorias::existe(&cats, c)) {
        return Err(pedido_invalido("categoria desconhecida"));
    }
    let mut movs = app.arm.ler_json("movimentacoes").await?;
    let Some(l) = movs.get_mut("movimentacoes").and_then(Value::as_array_mut) else {
        return Err(Erro(StatusCode::NOT_FOUND, "lançamento não encontrado".into()));
    };
    let Some(i) = l.iter().position(|m| m["id"].as_str() == Some(id.as_str())) else {
        return Err(Erro(StatusCode::NOT_FOUND, "lançamento não encontrado".into()));
    };
    // Ligar a uma dívida (nova): ela tem de existir.
    if let Some(Some(v)) = &n.vinculo {
        let atual = &l[i]["vinculo"];
        let mesma = atual["tipo"].as_str() == Some(v.tipo.trim()) && atual["id"].as_str() == Some(v.id.trim());
        if v.tipo.trim() == "divida" && !mesma {
            lancamentos::conferir_divida(&app.arm.ler_json("dividas").await?, v.id.trim())?;
        }
    }
    // Depois de migrar, a categoria tem de ser do mesmo tipo que a natureza (nova ou a atual).
    let natureza = n.natureza.clone().unwrap_or_else(|| l[i]["natureza"].as_str().unwrap_or("").to_string());
    if let Some(c) = &n.categoria {
        categorias::conferir_tipo(&cats, c, &natureza)?;
    }
    {
        let m = &mut l[i];
        if let Some(nome) = &n.nome {
            texto_ou_remove(m, "nome", nome);
        }
        if let Some(quem) = &n.quem {
            texto_ou_remove(m, "quem", quem);
        }
        if let Some(nat) = &n.natureza {
            if n.categoria.is_some() {
                m["natureza"] = json!(nat); // a categoria nova já foi conferida acima
            } else {
                // Só a natureza: um grupo do tipo errado solta o lançamento para "a classificar".
                categorias::ajustar_a_natureza(&cats, m, nat);
            }
        }
    }
    let mut alterados = vec![json!(id)];
    if let Some(categoria) = &n.categoria {
        alterados = lancamentos::aplicar_categoria(l, &id, &cats, categoria, &detalhe, n.mesma_descricao);
    }
    // Partes: uma categoria única escolhida sem partes desfaz a divisão; mudar a natureza
    // mantém as partes só se elas ainda servem. Partes novas valem só para este lançamento
    // (os de mesma descrição ficam só com a categoria).
    let partes = lancamentos::partes_pedidas(&l[i], &cats, n.partes, n.categoria.is_some(), n.natureza.is_some());
    let mut efeitos = lancamentos::editar(&mut l[i], &cats, partes, n.vinculo)?;
    // Uma fixa que outro lançamento ainda paga no mesmo mês não é desmarcada.
    efeitos.manter_fixas_ainda_ligadas(l, &id);

    // Efeitos fora do lançamento: aplicados em memória; se algum falhar, nada é gravado.
    let agora = agora_txt();
    let mut a = ler_para_efeitos(&app, efeitos.precisa_fixas(), efeitos.precisa_emprestimos(), efeitos.precisa_dividas()).await?;
    let dividas_lidas = a.dividas.clone();
    lancamentos::aplicar(&efeitos, &mut l[i], &mut a.fixas, &mut a.emprestimos, &mut a.dividas, &agora)?;
    if a.dividas == dividas_lidas {
        a.dividas = Value::Null; // ligar de novo à mesma dívida já paga: nada a gravar
    }
    let lancamento = l[i].clone();
    gravar_efeitos(&app, &a).await?;
    movs["atualizado_em"] = json!(agora);
    app.arm.gravar_valor("movimentacoes", &movs).await?;
    Ok(Json(json!({ "alterados": alterados, "lancamento": lancamento })))
}

#[derive(Deserialize)]
struct NomeEmLote {
    ids: Vec<String>,
    nome: String,
}

/// Dá o mesmo nome a vários lançamentos de uma vez (todas as parcelas de uma compra), numa gravação só.
async fn nomear_varios(State(app): State<App>, Json(n): Json<NomeEmLote>) -> Res<Value> {
    let nome = n.nome.trim();
    if nome.chars().count() > 120 {
        return Err(pedido_invalido("o nome pode ter até 120 letras"));
    }
    if n.ids.is_empty() || n.ids.len() > 200 {
        return Err(pedido_invalido("informe de 1 a 200 lançamentos"));
    }
    let _trava = app.escrita.lock().await;
    let mut movs = app.arm.ler_json("movimentacoes").await?;
    let ids: std::collections::HashSet<&str> = n.ids.iter().map(String::as_str).collect();
    let mut alterados = Vec::new();
    if let Some(l) = movs.get_mut("movimentacoes").and_then(Value::as_array_mut) {
        for m in l.iter_mut().filter(|m| m["id"].as_str().is_some_and(|i| ids.contains(i))) {
            if nome.is_empty() {
                if let Some(o) = m.as_object_mut() {
                    o.remove("nome");
                }
            } else {
                m["nome"] = json!(nome);
            }
            alterados.push(m["id"].clone());
        }
    }
    if alterados.is_empty() {
        return Err(Erro(StatusCode::NOT_FOUND, "lançamento não encontrado".into()));
    }
    movs["atualizado_em"] = json!(agora_txt());
    app.arm.gravar_valor("movimentacoes", &movs).await?;
    Ok(Json(json!({ "alterados": alterados })))
}

// ---------- sincronização com o banco (Pluggy) ----------

#[derive(Deserialize, Default)]
struct PedidoSincronizacao {
    /// Janela em dias (1 a 366). Ausente = automática.
    dias: Option<i64>,
}

async fn sincronizar(State(app): State<App>, pedido: Option<Json<PedidoSincronizacao>>) -> Res<Value> {
    let Some(p) = app.pluggy.as_ref() else {
        return Err(Erro(StatusCode::NOT_FOUND, "sincronização com o banco não configurada (PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET e PLUGGY_ITEM_ID)".into()));
    };
    let dias = pedido.and_then(|Json(p)| p.dias);
    if dias.is_some_and(|d| !(1..=366).contains(&d)) {
        return Err(pedido_invalido("dias deve estar entre 1 e 366"));
    }
    let _trava = app.escrita.lock().await;
    let hoje = agora().date_naive();
    let momento = agora_txt();
    let resultado = pluggy::sincronizar(&app.arm, p, hoje, &momento, dias).await;
    let execucao = match &resultado {
        Ok(r) => r.clone(),
        Err(e) => json!({ "em": momento, "ok": false, "erro": format!("{e:#}") }),
    };
    if let Err(e) = pluggy::registrar(&app.arm, execucao, &momento).await {
        tracing::error!("não consegui registrar a sincronização: {e:#}");
    }
    match resultado {
        Ok(r) => {
            tracing::info!("sincronização com a Pluggy concluída (gravou: {})", r["gravou"]);
            Ok(Json(r))
        }
        Err(e) => {
            tracing::error!("sincronização com a Pluggy falhou: {e:#}");
            Err(Erro(StatusCode::BAD_GATEWAY, format!("{e:#}")))
        }
    }
}

async fn estado_sincronizacao(State(app): State<App>) -> Res<Value> {
    let doc = app.arm.ler_json("sincronizacoes").await?;
    let execucoes = doc["execucoes"].as_array().cloned().unwrap_or_default();
    let ultima = execucoes.last().cloned();
    let ultima_ok = execucoes.iter().rev().find(|e| e["ok"] == true).cloned();
    Ok(Json(json!({ "configurada": app.pluggy.is_some(), "ultima": ultima, "ultima_ok": ultima_ok })))
}

// Categorias: enquanto `categorias.json` não foi migrado (versão 1), as rotas fazem o mesmo de
// sempre. Depois de migrar, `/categorias` trabalha com os grupos.

async fn listar_categorias(State(app): State<App>) -> Res<Value> {
    let cats = app.arm.ler_json("categorias").await?;
    let migrado = categorias::migrado(&cats);
    let grupos = if migrado { categorias::grupos(&cats) } else { categorias::todas(&cats) };
    Ok(Json(json!({ "migrado": migrado, "grupos": grupos })))
}

#[derive(Deserialize)]
struct NomeCategoria {
    nome: String,
}

fn corpo<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, Erro> {
    serde_json::from_value(v).map_err(|e| pedido_invalido(format!("pedido inválido: {e}")))
}

async fn criar_categoria(State(app): State<App>, Json(c): Json<Value>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let agora = agora_txt();
    let mut arq = app.arm.ler_json("categorias").await?;
    if categorias::migrado(&arq) {
        let n: categorias::NovoGrupo = corpo(c)?;
        let mut movs = app.arm.ler_json("movimentacoes").await?;
        let (grupo, movidos) = categorias::criar_grupo(&mut arq, &mut movs, &n, &agora, &agora[..10])?;
        // O grupo primeiro: se a gravação dos lançamentos falhar, eles só continuam em Outros.
        app.arm.gravar_valor("categorias", &arq).await?;
        if movidos > 0 {
            movs["atualizado_em"] = json!(agora);
            app.arm.gravar_valor("movimentacoes", &movs).await?;
        }
        return Ok(Json(json!({ "grupo": grupo, "movidos": movidos })));
    }
    let n: NomeCategoria = corpo(c)?;
    let c = categorias::criar(&mut arq, &n.nome, &agora)?;
    app.arm.gravar_valor("categorias", &arq).await?;
    Ok(Json(c))
}

async fn renomear_categoria(State(app): State<App>, Path(id): Path<String>, Json(c): Json<Value>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("categorias").await?;
    let c = if categorias::migrado(&arq) {
        categorias::editar_grupo(&mut arq, &id, &corpo(c)?, &agora_txt())?
    } else {
        let n: NomeCategoria = corpo(c)?;
        categorias::renomear(&mut arq, &id, &n.nome, &agora_txt())?
    };
    app.arm.gravar_valor("categorias", &arq).await?;
    Ok(Json(c))
}

#[derive(Deserialize, Default)]
struct DestinoExclusao {
    /// Para onde vão os lançamentos da categoria excluída (padrão: "A classificar"). Só antes de migrar.
    para: Option<String>,
}

/// Exclui uma categoria (sua ou fixa); os lançamentos dela vão para `para`. Depois de migrar,
/// apaga um grupo seu e os lançamentos vão para Outros gastos / Outras entradas.
async fn excluir_categoria(State(app): State<App>, Path(id): Path<String>, Query(d): Query<DestinoExclusao>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let agora = agora_txt();
    let mut arq = app.arm.ler_json("categorias").await?;
    if categorias::migrado(&arq) {
        let mut movs = app.arm.ler_json("movimentacoes").await?;
        let movidos = categorias::apagar_grupo(&mut arq, &mut movs, &id, &agora)?;
        // Os lançamentos primeiro: se a segunda gravação falhar, o grupo só fica vazio.
        if movidos > 0 {
            movs["atualizado_em"] = json!(agora);
            app.arm.gravar_valor("movimentacoes", &movs).await?;
        }
        app.arm.gravar_valor("categorias", &arq).await?;
        return Ok(Json(json!({ "movidos": movidos })));
    }
    let para = d.para.unwrap_or_else(|| "a_classificar".into());
    categorias::excluir(&mut arq, &id, &para, &agora)?;
    let mut movs = app.arm.ler_json("movimentacoes").await?;
    let movidos = categorias::mover_lancamentos(&mut movs, &id, &para);
    if movidos > 0 {
        movs["atualizado_em"] = json!(agora);
        app.arm.gravar_valor("movimentacoes", &movs).await?;
    }
    app.arm.gravar_valor("categorias", &arq).await?;
    Ok(Json(json!({ "lancamentos_movidos": movidos })))
}

/// Traz de volta uma categoria fixa que você excluiu (só antes de migrar).
async fn restaurar_categoria(State(app): State<App>, Path(id): Path<String>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let mut arq = app.arm.ler_json("categorias").await?;
    if categorias::migrado(&arq) {
        return Err(Erro(StatusCode::NOT_FOUND, "categoria não encontrada entre as excluídas".into()));
    }
    categorias::restaurar(&mut arq, &id, &agora_txt())?;
    app.arm.gravar_valor("categorias", &arq).await?;
    Ok(Json(json!({ "ok": true })))
}

fn hoje_txt() -> String {
    agora().format("%Y-%m-%d").to_string()
}

/// Categorias de gasto de hoje com o uso em 12 meses, para escolher quais viram grupo.
async fn uso_para_migrar(State(app): State<App>) -> Res<Value> {
    let cats = app.arm.ler_json("categorias").await?;
    let movs = app.arm.ler_json("movimentacoes").await?;
    Ok(Json(json!(categorias::uso_antigo(&cats, &movs, &hoje_txt()))))
}

#[derive(Deserialize)]
struct PedidoMigracao {
    #[serde(default)]
    manter: Vec<String>,
}

/// Migra as categorias para grupos, uma vez só (409 se já migrou).
async fn migrar_categorias(State(app): State<App>, Json(p): Json<PedidoMigracao>) -> Res<Value> {
    let _trava = app.escrita.lock().await;
    let agora = agora_txt();
    let mut cats = app.arm.ler_json("categorias").await?;
    let mut movs = app.arm.ler_json("movimentacoes").await?;
    let r = categorias::migrar(&mut cats, &mut movs, &p.manter, &agora)?;
    // Os lançamentos primeiro e as categorias (versão 2) por último: se a segunda gravação
    // falhar, o arquivo de categorias segue na versão 1 e dá para migrar de novo.
    movs["atualizado_em"] = json!(agora);
    app.arm.gravar_valor("movimentacoes", &movs).await?;
    app.arm.gravar_valor("categorias", &cats).await?;
    tracing::info!("categorias migradas: {} grupos seus, {} lançamentos movidos", r.grupos, r.movidos);
    Ok(Json(json!(r)))
}

/// Detalhes de Outros gastos que se repetem e poderiam virar grupo (vazio antes de migrar).
async fn sugestoes_de_grupos(State(app): State<App>) -> Res<Value> {
    let cats = app.arm.ler_json("categorias").await?;
    if !categorias::migrado(&cats) {
        return Ok(Json(json!([])));
    }
    let movs = app.arm.ler_json("movimentacoes").await?;
    Ok(Json(json!(categorias::sugestoes(&cats, &movs, &hoje_txt()))))
}

// ---------- cópia de segurança ----------

async fn exportar_backup(State(app): State<App>) -> Result<Response, Erro> {
    let mut arquivos = serde_json::Map::new();
    for (nome, _, _) in ARQUIVOS {
        if let Some(v) = app.arm.ler_valor(nome).await? {
            arquivos.insert(nome.to_string(), v);
        }
    }
    let corpo = json!({ "formato": "financeiro-backup", "versao": 1, "gerado_em": agora_txt(), "arquivos": arquivos });
    let mut r = Json(corpo).into_response();
    let nome = format!("financeiro-backup-{}.json", agora().format("%Y-%m-%d"));
    r.headers_mut().insert(header::CONTENT_DISPOSITION, HeaderValue::from_str(&format!("attachment; filename=\"{nome}\"")).unwrap());
    r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    Ok(r)
}

async fn restaurar_backup(State(app): State<App>, Json(b): Json<Value>) -> Res<Value> {
    if b["formato"] != "financeiro-backup" {
        return Err(pedido_invalido("este arquivo não é uma cópia de segurança do Financeiro"));
    }
    let Some(arquivos) = b["arquivos"].as_object() else { return Err(pedido_invalido("cópia sem arquivos")) };
    for (nome, v) in arquivos {
        if !arquivo_valido(nome) {
            return Err(pedido_invalido(format!("arquivo desconhecido na cópia: {nome}")));
        }
        if !v.is_object() {
            return Err(pedido_invalido(format!("{nome} não é um objeto JSON")));
        }
    }
    // Confere se o conteúdo lê no formato esperado antes de gravar qualquer coisa.
    let teste = Armazenamento::pasta(std::env::temp_dir().join(format!("financeiro-validacao-{}", std::process::id())))?;
    for (nome, v) in arquivos {
        teste.gravar_valor(nome, v).await?;
    }
    teste.carregar().await.map_err(|e| pedido_invalido(format!("cópia fora do formato: {e:#}")))?;
    if let Armazenamento::Pasta(d) = &teste {
        let _ = std::fs::remove_dir_all(d);
    }
    let _trava = app.escrita.lock().await;
    for (nome, v) in arquivos {
        app.arm.gravar_valor(nome, v).await?;
    }
    Ok(Json(json!({ "restaurados": arquivos.keys().collect::<Vec<_>>() })))
}

fn endereco() -> anyhow::Result<SocketAddr> {
    if let Ok(e) = std::env::var("FINANCEIRO_ENDERECO") {
        return Ok(e.parse()?);
    }
    // Render e outros serviços informam a porta em PORT.
    if let Ok(p) = std::env::var("PORT") {
        return Ok(format!("0.0.0.0:{p}").parse()?);
    }
    Ok("127.0.0.1:8080".parse()?)
}

/// Reaplica nos lançamentos já gravados as regras de classificação criadas depois (ex.: VMT →
/// Máquinas de ursinho). Roda antes de o servidor aceitar pedidos; uma falha só vai para o log.
async fn corrigir_classificacao(arm: &Armazenamento, agora: &str) {
    let r: anyhow::Result<usize> = async {
        let cats = arm.ler_json("categorias").await?;
        // Depois de migrar, as chaves antigas das regras não são mais categorias.
        if categorias::migrado(&cats) {
            return Ok(0);
        }
        let mut movs = arm.ler_json("movimentacoes").await?;
        let ocultas = categorias::ocultas(&cats);
        let n = importar::classificar::corrigir_com_regras_novas(&mut movs, &ocultas);
        if n > 0 {
            movs["atualizado_em"] = json!(agora);
            arm.gravar_valor("movimentacoes", &movs).await?;
        }
        Ok(n)
    }
    .await;
    match r {
        Ok(0) => {}
        Ok(n) => tracing::info!("{n} lançamentos reclassificados pelas regras novas"),
        Err(e) => tracing::error!("não consegui reaplicar as regras de classificação: {e:#}"),
    }
}

async fn iniciar(endereco: SocketAddr) -> anyhow::Result<App> {
    let arm = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.trim().is_empty() => {
            let url = url.trim();
            if !(url.starts_with("postgres://") || url.starts_with("postgresql://")) {
                anyhow::bail!("DATABASE_URL deve começar com postgresql:// (copie a connection string do Neon)");
            }
            tokio::time::timeout(Duration::from_secs(60), Armazenamento::postgres(url))
                .await
                .map_err(|_| anyhow::anyhow!("o Postgres não respondeu em 60 s (confira DATABASE_URL e se o projeto do Neon está ativo)"))??
        }
        _ => Armazenamento::pasta(std::env::var("FINANCEIRO_DADOS").unwrap_or_else(|_| "dados".into()))?,
    };
    let http = reqwest::Client::builder().user_agent("financeiro/0.3").timeout(Duration::from_secs(20)).build()?;
    let auth = Auth::do_ambiente(endereco.ip().is_loopback(), endereco, http.clone())?;
    let pluggy = pluggy::Pluggy::do_ambiente(reqwest::Client::builder().user_agent("financeiro/0.3").timeout(Duration::from_secs(60)).build()?)?;
    corrigir_classificacao(&arm, &agora_txt()).await;
    Ok(App {
        arm,
        http,
        escrita: Arc::new(Mutex::new(())),
        auth,
        pendentes: Default::default(),
        pluggy,
    })
}

/// Cabeçalho de cache dos arquivos do front-end.
/// `/assets/*` tem o hash no nome e pode ficar guardado; o resto (index.html, sw.js,
/// manifest) é revalidado a cada acesso para as atualizações chegarem.
/// Com as telas num site separado (FINANCEIRO_URL_APP), quem abre uma tela por este servidor
/// (o endereço antigo) é levado para o site das telas. A API continua respondendo aqui.
async fn telas_no_site(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let app = auth::url_app();
    let host = req.headers().get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("");
    let mesmo = app.split("://").nth(1) == Some(host);
    if app.is_empty() || mesmo || req.uri().path().starts_with("/api/") || !matches!(*req.method(), axum::http::Method::GET | axum::http::Method::HEAD) {
        return next.run(req).await;
    }
    let caminho = req.uri().path_and_query().map(|p| p.as_str()).unwrap_or("/");
    let mut r = StatusCode::PERMANENT_REDIRECT.into_response();
    if let Ok(v) = HeaderValue::from_str(&format!("{app}{caminho}")) {
        r.headers_mut().insert(header::LOCATION, v);
    }
    r
}

async fn cache_estatico(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let fixo = req.uri().path().starts_with("/assets/");
    let mut r = next.run(req).await;
    if r.status().is_success() && !r.headers().contains_key(header::CACHE_CONTROL) {
        let v = if fixo { "public, max-age=31536000, immutable" } else { "no-cache" };
        r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(v));
    }
    r
}

fn rotas_do_app(app: App, dir_front: &std::path::Path) -> anyhow::Result<Router> {
    let api = Router::new()
        .route("/saude", get(saude))
        .route("/sessao", get(auth::estado).post(auth::entrar).delete(auth::sair))
        .route("/auth/google", get(auth::google_iniciar))
        .route("/auth/google/retorno", get(auth::google_retorno))
        .route("/visao-geral", get(visao_geral))
        .route("/fontes", get(fontes))
        .route("/dados/:arquivo", get(arquivo))
        .route("/contas/:id", patch(mudar_papel_conta))
        .route("/metas", post(criar_meta))
        .route("/metas/:id", put(editar_meta).delete(excluir_meta))
        .route("/metas/:id/guardar", post(guardar_na_meta))
        .route("/fixas", post(criar_fixa))
        .route("/fixas/ignoradas", post(ignorar_sugestao))
        .route("/fixas/:id", put(editar_fixa).delete(excluir_fixa))
        .route("/fixas/:id/pago", post(marcar_fixa_paga))
        .route("/categorias", get(listar_categorias).post(criar_categoria))
        // Antes de "/categorias/:id", para não serem lidas como um id.
        .route("/categorias/migracao", get(uso_para_migrar))
        .route("/categorias/migrar", post(migrar_categorias))
        .route("/categorias/sugestoes", get(sugestoes_de_grupos))
        .route("/categorias/:id", put(renomear_categoria).delete(excluir_categoria))
        .route("/categorias/:id/restaurar", post(restaurar_categoria))
        .route("/indicadores/atualizar", post(atualizar_indicadores))
        .route("/importacoes", post(analisar_documento).layer(DefaultBodyLimit::max(15 * 1024 * 1024)))
        .route("/importacoes/:id", delete(descartar_documento))
        .route("/importacoes/:id/confirmar", post(confirmar_documento))
        .route("/originais/:sha", get(baixar_original))
        .route("/dividas", post(criar_divida))
        .route("/dividas/tipos", post(criar_tipo_divida))
        .route("/dividas/tipos/:id", delete(apagar_tipo_divida))
        .route("/dividas/:id", put(editar_divida).delete(excluir_divida))
        .route("/dividas/:id/recusar", post(recusar_sugestao_divida))
        .route("/emprestimos", post(criar_emprestimo))
        .route("/emprestimos/:id", put(editar_emprestimo).delete(excluir_emprestimo))
        .route("/emprestimos/:id/pagamentos", post(pagar_emprestimo))
        .route("/emprestimos/:id/pagamentos/:pid", delete(desfazer_pagamento))
        .route("/movimentacoes", post(criar_lancamento))
        .route("/movimentacoes/nomear", post(nomear_varios))
        .route("/movimentacoes/:id", patch(reclassificar).delete(apagar_lancamento))
        .route("/sincronizar", post(sincronizar))
        .route("/sincronizacao", get(estado_sincronizacao))
        .route("/backup", get(exportar_backup).post(restaurar_backup).layer(DefaultBodyLimit::max(30 * 1024 * 1024)))
        .layer(axum::middleware::from_fn_with_state(app.clone(), auth::exigir))
        .layer(SetResponseHeaderLayer::overriding(header::CACHE_CONTROL, HeaderValue::from_static("private, no-store")))
        .with_state(app);

    let mut rotas = Router::new().nest("/api", api);
    if dir_front.join("index.html").exists() {
        let spa = ServeDir::new(dir_front).fallback(ServeFile::new(dir_front.join("index.html")));
        rotas = rotas.fallback_service(spa).layer(axum::middleware::from_fn(cache_estatico)).layer(axum::middleware::from_fn(telas_no_site));
    } else {
        tracing::warn!("front-end não encontrado em {} (só a API está no ar)", dir_front.display());
        rotas = rotas.fallback(|| async {
            (StatusCode::NOT_FOUND, axum::response::Html("<p>Front-end não encontrado no servidor. Confira FINANCEIRO_FRONTEND.</p>"))
        });
    }
    // CORS liberado para o site das telas (FINANCEIRO_URL_APP) e para o servidor de desenvolvimento do Vite.
    let mut origens: Vec<HeaderValue> = vec!["http://localhost:5173".parse()?, "http://127.0.0.1:5173".parse()?];
    if !auth::url_app().is_empty() {
        origens.push(auth::url_app().parse()?);
    }
    let cors = CorsLayer::new()
        .allow_origin(origens)
        .allow_credentials(true)
        .allow_headers([header::CONTENT_TYPE, "x-financeiro".parse()?])
        .allow_methods([axum::http::Method::GET, axum::http::Method::POST, axum::http::Method::PUT, axum::http::Method::PATCH, axum::http::Method::DELETE]);
    Ok(rotas.layer(cors))
}

fn escapar_html(t: &str) -> String {
    t.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Página mostrada quando a configuração impede o sistema de iniciar. Mostra só o motivo
/// (nunca o valor das variáveis). `/api/saude` responde 200 com ok=false para o Render
/// publicar o serviço e a página ficar visível no link.
fn rotas_de_diagnostico(msg: String) -> Router {
    let pagina = Arc::new(format!(
        "<!doctype html><html lang=pt-BR><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>\
<meta name=robots content=noindex><title>Configuração pendente</title>\
<body style='font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5'>\
<h1 style='font-size:1.3rem'>O servidor está no ar, mas o sistema não conseguiu iniciar</h1>\
<p>Motivo:</p><pre style='white-space:pre-wrap;background:#f1f1f1;padding:.75rem;border-radius:6px'>{}</pre>\
<p>Corrija em <b>Render → seu serviço → Environment</b> e salve. O Render publica de novo sozinho.</p>\
<p>Variáveis esperadas: <code>DATABASE_URL</code>; para o login com Google, <code>GOOGLE_CLIENT_ID</code>, \
<code>GOOGLE_CLIENT_SECRET</code> e <code>FINANCEIRO_EMAIL</code>; para o login por senha (opcional com o Google), \
<code>FINANCEIRO_USUARIO</code> e <code>FINANCEIRO_SENHA</code> (10 caracteres ou mais); \
e, se quiser, <code>FINANCEIRO_SEGREDO</code> (32 caracteres ou mais).</p>",
        escapar_html(&msg)
    ));
    let msg = Arc::new(msg);
    Router::new()
        .route("/api/saude", get(move || async move { Json(json!({ "ok": false, "erro": *msg })) }))
        .fallback(move || async move {
            (StatusCode::SERVICE_UNAVAILABLE, [(header::CACHE_CONTROL, "no-store")], axum::response::Html((*pagina).clone()))
        })
}

fn anunciar(app: &App, endereco: SocketAddr) {
    tracing::info!(
        "Financeiro em http://{endereco} · dados em {} · login {}",
        app.arm.descricao(),
        if app.auth.exigida() { "ligado" } else { "desligado" }
    );
    if app.pluggy.is_some() {
        tracing::info!("sincronização com a Pluggy configurada (POST /api/sincronizar)");
    }
    if let Some(retorno) = app.auth.retorno_google() {
        tracing::info!("login com Google ligado · URI de redirecionamento a cadastrar no Google Cloud: {retorno}");
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=warn,pdf_extract=error".into()))
        .init();

    // O `.env` da raiz (ou FINANCEIRO_ENV) só preenche o que o ambiente não trouxe.
    let env = std::env::var("FINANCEIRO_ENV").unwrap_or_else(|_| ".env".into());
    let n = arquivo_env::carregar(std::path::Path::new(&env));
    if n > 0 {
        tracing::info!("{n} configuração(ões) lida(s) de {env}");
    }

    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("gerar-hash") {
        let senha = args.next().ok_or_else(|| anyhow::anyhow!("uso: financeiro-api gerar-hash 'sua senha'"))?;
        println!("{}", auth::gerar_hash(&senha)?);
        return Ok(());
    }

    let endereco = endereco()?;
    // Abre a porta antes de conectar no banco: o Render só dá o serviço como no ar quando a
    // porta responde, e um erro de configuração vira uma página legível em vez de link morto.
    let ouvinte = tokio::net::TcpListener::bind(endereco).await?;
    let dir_front = PathBuf::from(std::env::var("FINANCEIRO_FRONTEND").unwrap_or_else(|_| "frontend/dist".into()));

    let rotas = match iniciar(endereco).await {
        Ok(app) => {
            anunciar(&app, endereco);
            rotas_do_app(app, &dir_front)?
        }
        Err(e) => {
            tracing::error!("não consegui iniciar: {e:#}");
            tracing::error!("servindo a página de diagnóstico em http://{endereco}; nova tentativa a cada minuto");
            // Continua no ar (sair faria o Render mandar alerta de falha a cada reinício) e tenta
            // de novo em segundo plano: cobre o Neon demorando a acordar. Variável errada só se
            // resolve corrigindo no Render, que publica de novo sozinho.
            let atual = Arc::new(tokio::sync::RwLock::new(rotas_de_diagnostico(format!("{e:#}"))));
            let alvo = atual.clone();
            let dir = dir_front.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    match iniciar(endereco).await {
                        Ok(app) => match rotas_do_app(app.clone(), &dir) {
                            Ok(r) => {
                                anunciar(&app, endereco);
                                *alvo.write().await = r;
                                break;
                            }
                            Err(e) => tracing::error!("ainda não consegui iniciar: {e:#}"),
                        },
                        Err(e) => {
                            *alvo.write().await = rotas_de_diagnostico(format!("{e:#}"));
                            tracing::error!("ainda não consegui iniciar: {e:#}");
                        }
                    }
                }
            });
            Router::new().fallback(move |req: axum::extract::Request| {
                let atual = atual.clone();
                async move {
                    let r = atual.read().await.clone();
                    tower::ServiceExt::oneshot(r, req).await.into_response()
                }
            })
        }
    };
    let rotas = rotas
        .layer(SetResponseHeaderLayer::overriding(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(SetResponseHeaderLayer::overriding(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY")))
        .layer(SetResponseHeaderLayer::overriding(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer")))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000"),
        ))
        .layer(TraceLayer::new_for_http());

    axum::serve(ouvinte, rotas).await?;
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;

    fn form(extra: Value) -> NovaDivida {
        let mut f = json!({ "nome": "Carro", "tipo": "emprestimo", "valor_atual": 1000.0, "data_referencia": "2026-01-01",
            "parcelas_restantes": 10, "valor_parcela": 250.0, "proximo_vencimento": "2026-01-31", "taxa_mensal": 2.0 });
        for (k, v) in extra.as_object().unwrap() {
            f[k] = v.clone();
        }
        serde_json::from_value(f).unwrap()
    }

    /// Dívida cadastrada e paga com um lançamento de 250 em 30/01 (saldo estimado 750).
    fn paga() -> (Value, Value) {
        let mut d = json!({ "id": "d1" });
        aplicar_campos(&mut d, &form(json!({})), "t0");
        let mut dv = json!({ "dividas": [d] });
        let antes = dividas::pagar(&mut dv, "d1", &json!({ "id": "m1", "data": "2026-01-30", "valor": -250.0 })).unwrap();
        (dv, antes)
    }

    /// O formulário de edição vem preenchido com o estado atual e o último saldo (aqui, o estimado
    /// do lançamento).
    fn como_na_tela(extra: Value) -> NovaDivida {
        let mut f = json!({ "valor_atual": 750.0, "data_referencia": "2026-01-30", "parcelas_restantes": 9, "proximo_vencimento": "2026-02-28" });
        for (k, v) in extra.as_object().unwrap() {
            f[k] = v.clone();
        }
        form(f)
    }

    #[test]
    fn editar_so_o_tipo_nao_estraga_o_desfazer() {
        let (mut dv, antes) = paga();
        let mut sem_pagar = json!({ "id": "d1" });
        aplicar_campos(&mut sem_pagar, &form(json!({ "tipo": "outras", "nome": "Carro novo", "taxa_mensal": 3.0, "obs": "x", "credor": "Banco" })), "t1");
        sem_pagar["pagamentos"] = json!([]);
        editar_campos(&mut dv["dividas"][0], &como_na_tela(json!({ "tipo": "outras", "nome": "Carro novo", "taxa_mensal": 3.0, "obs": "x", "credor": "Banco" })), "t1");
        let d = &dv["dividas"][0];
        assert!(d["pagamentos"][0].get("editada_depois").is_none(), "nada que o pagamento mexe mudou");
        let origens: Vec<&str> = d["saldos"].as_array().unwrap().iter().filter_map(|s| s["origem"]["tipo"].as_str()).collect();
        assert_eq!(origens, vec!["informado", "lancamento"], "o saldo do lançamento continua sendo do lançamento");
        dividas::desfazer_pagamento(&mut dv, "d1", "m1", &antes).unwrap();
        assert_eq!(dv["dividas"][0], sem_pagar, "desligar restaura exatamente");
    }

    #[test]
    fn editar_o_que_o_pagamento_mexe_marca_editada() {
        for (rotulo, extra) in [
            ("parcelas", json!({ "parcelas_restantes": 12 })),
            ("vencimento", json!({ "proximo_vencimento": "2026-03-05" })),
            ("saldo", json!({ "valor_atual": 700.0 })),
            ("data do saldo", json!({ "data_referencia": "2026-02-01" })),
            ("saldo zero", json!({ "valor_atual": 0.0 })),
        ] {
            let (mut dv, _) = paga();
            editar_campos(&mut dv["dividas"][0], &como_na_tela(extra), "t1");
            assert_eq!(dv["dividas"][0]["pagamentos"][0]["editada_depois"], true, "{rotulo}");
        }
        // Saldo estimado zerou com parcelas faltando (7ª de 9): renomear não quita nem marca.
        let (mut dv, _) = paga();
        dv["dividas"][0]["parcelas_restantes"] = json!(2);
        dv["dividas"][0]["saldos"][1]["saldo_devedor"] = json!(0.0);
        editar_campos(&mut dv["dividas"][0], &como_na_tela(json!({ "nome": "Carro renomeado", "parcelas_restantes": 2, "valor_atual": 0.0 })), "t1");
        assert_eq!(dv["dividas"][0]["situacao"], "ativa", "com parcelas, saldo 0 não quita");
        assert!(dv["dividas"][0]["pagamentos"][0].get("editada_depois").is_none(), "só renomear não marca editada");
        // Sem parcelas, saldo 0 quita.
        let mut d = json!({ "id": "d2" });
        aplicar_campos(&mut d, &form(json!({ "parcelas_restantes": null, "valor_atual": 0.0 })), "t0");
        assert_eq!(d["situacao"], "quitada");
        // Com parcelas, quitada é quando elas acabam (mesmo com saldo informado).
        let mut d = json!({ "id": "d1" });
        aplicar_campos(&mut d, &form(json!({ "parcelas_restantes": 0, "valor_atual": 50.0 })), "t0");
        assert_eq!(d["situacao"], "quitada");
    }
}
