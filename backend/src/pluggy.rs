//! Sincronização com a Pluggy (Open Finance pelo conector MeuPluggy).
//!
//! Só leitura: autentica, lê a conexão (item), as contas e as transações, e grava as
//! transações em `movimentacoes` com `id = "pluggy-<id da transação>"`. Nunca pede para a
//! Pluggy atualizar a conexão: o MeuPluggy faz isso sozinho a cada 24 horas.
//!
//! Regras:
//! - **Sinal**: na conta corrente a Pluggy já usa saída negativa. No cartão é o contrário
//!   (compra positiva, pagamento negativo), então o valor é invertido.
//! - **Datas** chegam em UTC e são convertidas para o horário de Brasília.
//! - **Competência** do cartão = fatura prevista pela Pluggy (`billForecastDate`).
//! - **Sem duplicar documentos**: meses já cobertos por fatura/extrato enviados em arquivo
//!   (lançamentos com `origem.documento_id`) continuam valendo; a Pluggy só preenche os meses
//!   seguintes daquela conta.
//! - **Atualização**: lançamento que já existe é atualizado (pendente vira confirmado, valor
//!   muda), mas a categoria já definida (por você ou na primeira importação) é mantida. Lançamento da Pluggy que sumiu
//!   da janela consultada (ex.: compra pendente substituída) é removido.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use chrono::{DateTime, FixedOffset, NaiveDate};
use regex::Regex;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::armazenamento::Armazenamento;
use crate::importar::classificar::Classificador;
use crate::importar::{hash_mov, r2};

const API: &str = "https://api.pluggy.ai";
/// A chave da Pluggy vale 2 horas; renovamos um pouco antes.
const VALIDADE_CHAVE: Duration = Duration::from_secs(110 * 60);
/// Primeira sincronização de uma conta: até um ano para trás.
pub const DIAS_PRIMEIRA: i64 = 365;
/// Sincronizações seguintes: janela que se sobrepõe para pegar lançamentos atrasados.
pub const DIAS_DIARIA: i64 = 15;
const EXECUCOES_GUARDADAS: usize = 60;

#[derive(Clone)]
pub struct Pluggy {
    http: reqwest::Client,
    client_id: String,
    client_secret: String,
    /// Uma ou mais conexões MeuPluggy (ex.: Santander e Mercado Pago).
    item_ids: Vec<String>,
    chave: Arc<Mutex<Option<(String, Instant)>>>,
}

fn var(nome: &str) -> String {
    std::env::var(nome).unwrap_or_default().trim().to_string()
}

fn parece_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().enumerate().all(|(i, c)| if [8, 13, 18, 23].contains(&i) { c == '-' } else { c.is_ascii_hexdigit() })
}

impl Pluggy {
    /// Lê `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` e `PLUGGY_ITEM_ID` (um ou mais ids de conexão,
    /// separados por vírgula). Sem o client id, a sincronização fica desligada.
    pub fn do_ambiente(http: reqwest::Client) -> Result<Option<Self>> {
        let client_id = var("PLUGGY_CLIENT_ID");
        if client_id.is_empty() {
            return Ok(None);
        }
        let client_secret = var("PLUGGY_CLIENT_SECRET");
        let item_ids: Vec<String> = var("PLUGGY_ITEM_ID").split([',', ';', ' ', '\n']).map(str::trim).filter(|x| !x.is_empty()).map(String::from).collect();
        if client_secret.is_empty() {
            bail!("defina PLUGGY_CLIENT_SECRET (Dashboard da Pluggy → Aplicações → sua aplicação)");
        }
        if !parece_uuid(&client_id) {
            bail!("PLUGGY_CLIENT_ID fora do formato (deve ser só o id, como 1234abcd-…, sem https:// e sem barra)");
        }
        if item_ids.is_empty() || !item_ids.iter().all(|i| parece_uuid(i)) {
            bail!("PLUGGY_ITEM_ID ausente ou fora do formato: use o id de cada conexão MeuPluggy (Itens Conectados), separados por vírgula, não o id da aplicação");
        }
        Ok(Some(Self { http, client_id, client_secret, item_ids, chave: Default::default() }))
    }

    async fn chave(&self) -> Result<String> {
        let mut c = self.chave.lock().await;
        if let Some((k, quando)) = c.as_ref() {
            if quando.elapsed() < VALIDADE_CHAVE {
                return Ok(k.clone());
            }
        }
        let r = self
            .http
            .post(format!("{API}/auth"))
            .json(&json!({ "clientId": self.client_id, "clientSecret": self.client_secret }))
            .send()
            .await
            .context("a Pluggy não respondeu (autenticação)")?;
        let k = resposta(r, "autenticação").await?["apiKey"].as_str().map(String::from).context("a Pluggy não devolveu a chave de acesso")?;
        *c = Some((k.clone(), Instant::now()));
        Ok(k)
    }

    async fn get(&self, url: &str, oque: &str) -> Result<Value> {
        let r = self.http.get(url).header("X-API-KEY", self.chave().await?).send().await.with_context(|| format!("a Pluggy não respondeu ({oque})"))?;
        if r.status() == reqwest::StatusCode::UNAUTHORIZED {
            // Chave vencida antes da hora: descarta para a próxima tentativa pedir outra.
            *self.chave.lock().await = None;
        }
        resposta(r, oque).await
    }

    pub async fn item(&self, item_id: &str) -> Result<Value> {
        self.get(&format!("{API}/items/{item_id}"), "conexão").await
    }

    pub async fn contas(&self, item_id: &str) -> Result<Vec<Value>> {
        let v = self.get(&format!("{API}/accounts?itemId={item_id}"), "contas").await?;
        Ok(v["results"].as_array().cloned().unwrap_or_default())
    }

    /// Faturas já fechadas do cartão (a Pluggy não informa a fatura aberta).
    pub async fn faturas(&self, conta: &str) -> Result<Value> {
        let url = reqwest::Url::parse_with_params(&format!("{API}/bills"), [("accountId", conta), ("pageSize", "12")])?;
        self.get(url.as_str(), "faturas").await
    }

    /// Todas as transações da conta entre as datas (inclusive), seguindo o cursor da API v2.
    pub async fn transacoes(&self, conta: &str, de: NaiveDate, ate: NaiveDate) -> Result<Vec<Value>> {
        let primeira = reqwest::Url::parse_with_params(
            &format!("{API}/v2/transactions"),
            [("accountId", conta), ("dateFrom", &de.to_string()), ("dateTo", &ate.to_string())],
        )?;
        let mut url = primeira.to_string();
        let mut out = Vec::new();
        for _ in 0..200 {
            let v = self.get(&url, "transações").await?;
            out.extend(v["results"].as_array().cloned().unwrap_or_default());
            match v["next"].as_str().filter(|n| !n.is_empty()) {
                Some(n) => url = format!("{API}/v2/transactions{n}"),
                None => return Ok(out),
            }
        }
        bail!("a Pluggy devolveu páginas demais de transações")
    }
}

async fn resposta(r: reqwest::Response, oque: &str) -> Result<Value> {
    let status = r.status();
    let corpo: Value = r.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let cod = corpo["codeDescription"].as_str().unwrap_or("");
        let msg = corpo["message"].as_str().unwrap_or("");
        let dica = match cod {
            "CLIENT_KEYS_UNAUTHORIZED" => " · confira PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET",
            "ITEM_NOT_FOUND" => " · PLUGGY_ITEM_ID não pertence a esta aplicação (use o id da conexão MeuPluggy)",
            _ => "",
        };
        bail!("Pluggy recusou ({oque}): {status} {cod} {msg}{dica}");
    }
    Ok(corpo)
}

// ---------- conversão de uma transação ----------

fn brasilia() -> FixedOffset {
    FixedOffset::west_opt(3 * 3600).unwrap()
}

/// Data ISO em UTC → dia no horário de Brasília (`AAAA-MM-DD`).
pub fn data_brasilia(iso: &str) -> Option<String> {
    let d = DateTime::parse_from_rfc3339(iso).ok()?;
    Some(d.with_timezone(&brasilia()).format("%Y-%m-%d").to_string())
}

/// Descrição legível. Compras no débito chegam como "DEBITO VISA ELECTRON BRASIL   09/11 LOJA";
/// a parte útil é o nome da loja, que fica no `descriptionRaw`.
pub fn descricao(t: &Value) -> String {
    let bruta = t["descriptionRaw"].as_str().filter(|s| !s.trim().is_empty()).or(t["description"].as_str()).unwrap_or("");
    let limpa = bruta.split_whitespace().collect::<Vec<_>>().join(" ");
    let rx = Regex::new(r"^DEBITO (?:VISA ELECTRON|MAESTRO|ELO|MASTERCARD)?\s*(?:BRASIL)?\s*\d{2}/\d{2}\s+(.+)$").unwrap();
    if let Some(c) = rx.captures(&limpa.to_uppercase()) {
        let loja = limpa[limpa.len() - c[1].len()..].trim();
        if !loja.is_empty() {
            return loja.to_string();
        }
    }
    let d = t["description"].as_str().unwrap_or(&limpa);
    d.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Categoria da Pluggy → categoria do sistema (usada quando o classificador não sabe).
pub fn categoria_da_pluggy(cat: &str) -> Option<&'static str> {
    Some(match cat.to_lowercase().as_str() {
        "groceries" | "supermarket" => "mercado",
        "eating out" | "food delivery" | "restaurants" | "bars" => "alimentacao",
        "gas stations" | "parking" | "taxi and ride-hailing" | "vehicle maintenance" | "automotive" | "tolls" | "public transportation"
        | "transportation" | "bicycle" => "transporte",
        "shopping" | "clothing" | "electronics" | "sports goods" | "kids and toys" | "houseware" | "bookstore" | "pet supplies" | "gifts"
        | "online shopping" | "department stores" => "compras",
        "digital services" | "streaming" | "software" => "assinaturas",
        "internet" | "telecommunications" | "electricity" | "water" | "rent" | "housing" | "utilities" | "condominium" => "contas_casa",
        "services" | "insurance" | "life insurance" | "home insurance" | "vehicle insurance" => "servicos",
        "pharmacy" | "health" | "healthcare" | "hospital clinics and labs" | "dentist" | "optometry" => "saude",
        "leisure" | "cinema, theater and concerts" | "accomodation" | "accommodation" | "travel" | "airport and airlines" | "entertainment"
        | "gaming" | "lottery" => "lazer",
        "education" | "school" | "university" | "courses" => "educacao",
        "beauty" | "wellness" | "gyms and fitness centers" => "cuidados_pessoais",
        "credit card fees" | "bank fees" | "account fees" => "tarifas_bancarias",
        "interests charged" | "late payment and overdraft costs" | "iof" => "encargos_financeiros",
        "taxes" | "income taxes" | "vehicle taxes" | "tax on financial operations" => "impostos",
        "transfer - pix" | "transfer - ted" | "transfer - doc" | "transfers" | "transfer - bank slip" | "same person transfer" => "transferencias",
        "proceeds interests and dividends" | "investments" | "fixed income" | "variable income" => "investimentos",
        "salary" => "salario",
        "loans and financing" | "loans" | "financing" => "emprestimos",
        _ => return None,
    })
}

struct Classe {
    natureza: &'static str,
    categoria: String,
    subcategoria: Option<String>,
    classificacao: String,
}

fn classe(natureza: &'static str, categoria: &str, classificacao: &str) -> Classe {
    Classe { natureza, categoria: categoria.into(), subcategoria: None, classificacao: classificacao.into() }
}

/// Categoria de um gasto: o que você já ensinou ao sistema e as regras primeiro; senão, a da Pluggy.
/// Devolve a chave antiga (a tradução para grupo fica em `finalizar`, no `converter`); depois de
/// migrar, uma chave sem grupo conta como "não sei" e a da Pluggy ganha a vez.
fn categoria_de_gasto(desc: &str, cat_pluggy: &str, regras: &Classificador) -> (String, Option<String>, String) {
    let tem_grupo = |c: &str| regras.categoria_final("despesa", c) != "a_classificar";
    let c = regras.classificar_chave(desc);
    if tem_grupo(&c.categoria) {
        return (c.categoria, c.subcategoria, c.classificacao);
    }
    match categoria_da_pluggy(cat_pluggy).filter(|c| !regras.oculta(c) && tem_grupo(c)) {
        Some(cat) => (cat.into(), None, "media".into()),
        None => ("a_classificar".into(), None, "baixa".into()),
    }
}

/// A chave antiga de um gasto antes de saber se ela tem grupo: a das regras (ou o que você
/// ensinou), senão a da Pluggy. Sem migrar, é a mesma de `categoria_de_gasto`.
fn chave_de_gasto(desc: &str, cat_pluggy: &str, regras: &Classificador) -> String {
    let c = regras.classificar_chave(desc);
    if c.categoria != "a_classificar" {
        return c.categoria;
    }
    categoria_da_pluggy(cat_pluggy).filter(|c| !regras.oculta(c)).unwrap_or("a_classificar").to_string()
}

fn natureza(cartao: bool, valor: f64, desc: &str, cat_pluggy: &str, operacao: &str, regras: &Classificador) -> Classe {
    let u = desc.to_uppercase();
    let rx = |p: &str| Regex::new(p).unwrap().is_match(&u);
    if cat_pluggy.eq_ignore_ascii_case("Credit card payment") || operacao == "PAGAMENTO_FATURA" || rx(r"PAGAMENTO (DE )?(FATURA|CART)|PAGTO CART|FATURA CART") {
        return classe("transferencia_interna", "pagamento_fatura_cartao", "alta");
    }
    if cartao {
        if valor > 0.0 {
            return classe("estorno", "outros", "media");
        }
        let (categoria, subcategoria, classificacao) = categoria_de_gasto(desc, cat_pluggy, regras);
        return Classe { natureza: "despesa", categoria, subcategoria, classificacao };
    }
    if operacao == "FOLHA_PAGAMENTO" || cat_pluggy.eq_ignore_ascii_case("Salary") {
        return classe("receita", "salario", "alta");
    }
    if operacao.starts_with("RENDIMENTO") || cat_pluggy.eq_ignore_ascii_case("Proceeds interests and dividends") {
        return classe("receita", "investimentos", "media");
    }
    if cat_pluggy.eq_ignore_ascii_case("Loans and financing") {
        // Dinheiro de empréstimo não é renda: fica fora dos totais até você decidir.
        return if valor > 0.0 { classe("emprestimo_recebido", "emprestimos", "media") } else { classe("pagamento_divida", "emprestimos", "media") };
    }
    if rx(r"APLICA[CÇ][AÃ]O|APLIC\.") && valor < 0.0 {
        return classe("aporte_investimento", "investimentos", "media");
    }
    if rx(r"RESGATE|RESG\.") && valor > 0.0 {
        return classe("resgate_investimento", "investimentos", "media");
    }
    if valor > 0.0 {
        if rx(r"ESTORNO|DEVOLU") {
            return classe("estorno", "outros", "media");
        }
        return classe("receita", "outras_receitas", "baixa");
    }
    let (mut categoria, subcategoria, classificacao) = categoria_de_gasto(desc, cat_pluggy, regras);
    if categoria == "transferencias_pix" {
        // "Pix no cartão" é do cartão de crédito; na conta é transferência comum.
        categoria = "transferencias".into();
    }
    Classe { natureza: "despesa", categoria, subcategoria, classificacao }
}

/// Converte uma transação da Pluggy numa movimentação do sistema.
/// Devolve `None` para parcelas futuras projetadas (sem fatura definida), que ainda não aconteceram.
pub fn converter(conta: &Value, t: &Value, conta_id: &str, regras: &Classificador) -> Option<Value> {
    let tid = t["id"].as_str()?;
    let cartao = conta["type"].as_str() == Some("CREDIT");
    let amount = t["amount"].as_f64()?;
    let valor = r2(if cartao { -amount } else { amount });
    let data = data_brasilia(t["date"].as_str()?)?;
    let meta = &t["creditCardMetadata"];
    let fatura = meta["billForecastDate"].as_str().filter(|s| s.len() == 7 && !s.starts_with("0001"));
    let pendente = t["status"].as_str() == Some("PENDING");
    let n_parcela = meta["installmentNumber"].as_u64();
    let total_parcelas = meta["totalInstallments"].as_u64();
    if cartao && pendente && fatura.is_none() && n_parcela.unwrap_or(0) > 1 {
        return None;
    }
    let competencia = if cartao { fatura.unwrap_or(&data[..7]).to_string() } else { data[..7].to_string() };
    let desc = descricao(t);
    let cat_pluggy = t["category"].as_str().unwrap_or("");
    let operacao = t["operationType"].as_str().unwrap_or("");
    let c = natureza(cartao, valor, &desc, cat_pluggy, operacao, regras);
    let parcela = match (n_parcela, total_parcelas) {
        (Some(n), Some(tot)) if tot > 1 => Some(format!("{n:02}/{tot:02}")),
        _ => None,
    };
    let data_compra = parcela.as_ref().and(meta["purchaseDate"].as_str()).and_then(data_brasilia);
    // Pela chave crua (antes de virar grupo): não perde o "fixa" quando Assinaturas não virou grupo.
    let chave = if c.natureza == "despesa" { chave_de_gasto(&desc, cat_pluggy, regras) } else { c.categoria.clone() };
    let recorrencia = if matches!(chave.as_str(), "assinaturas" | "salario") { "fixa" } else { "variavel" };
    let mut m = json!({
        "id": format!("pluggy-{tid}"),
        "conta_id": conta_id,
        "data": data,
        "descricao": desc,
        "valor": valor,
        "natureza": c.natureza,
        "categoria": c.categoria,
        "subcategoria": c.subcategoria,
        "classificacao": c.classificacao,
        "recorrencia": recorrencia,
        "competencia": competencia,
        "origem": {
            "fonte": "pluggy",
            "pluggy_id": tid,
            "pluggy_conta": conta["id"],
            "categoria_pluggy": t["category"],
        },
        "status": if pendente { "pendente" } else { "confirmado" },
        "hash": hash_mov(conta_id, &data, valor, &desc, parcela.as_deref().unwrap_or(""), &competencia),
    });
    if let Some(p) = parcela {
        m["parcela"] = json!(p);
        m["data_compra"] = json!(data_compra);
    }
    // Depois de migrar, a chave antiga (regra ou categoria da Pluggy) vira o grupo.
    regras.finalizar(&mut m);
    Some(m)
}

// ---------- vínculo das contas e mescla ----------

fn final4(numero: &str) -> String {
    let d: String = numero.chars().filter(char::is_ascii_alphanumeric).collect();
    d[d.len().saturating_sub(4)..].to_string()
}

/// Acha a conta do sistema que corresponde à conta da Pluggy: primeiro por `pluggy_id`,
/// depois pelo tipo e pelos últimos dígitos.
pub fn conta_vinculada(config: &Value, conta: &Value) -> Option<String> {
    let contas = config["contas"].as_array()?;
    let pid = conta["id"].as_str()?;
    if let Some(c) = contas.iter().find(|c| c["pluggy_id"].as_str() == Some(pid)) {
        return c["id"].as_str().map(String::from);
    }
    let cartao = conta["type"].as_str() == Some("CREDIT");
    let fim = final4(conta["number"].as_str().unwrap_or(""));
    let mesmo_tipo = |c: &&Value| {
        let t = c["tipo"].as_str().unwrap_or("");
        if cartao { t == "cartao" } else { t.contains("corrente") }
    };
    let candidatas: Vec<&Value> = contas.iter().filter(mesmo_tipo).filter(|c| c["pluggy_id"].is_null()).collect();
    if !fim.is_empty() {
        if let Some(c) = candidatas.iter().find(|c| {
            let f: String = c["final"].as_str().unwrap_or("").chars().filter(char::is_ascii_alphanumeric).collect();
            (!f.is_empty() && (f.ends_with(&fim) || fim.ends_with(&f))) || c["id"].as_str().is_some_and(|id| id.ends_with(&fim))
        }) {
            return c["id"].as_str().map(String::from);
        }
    }
    // Conta corrente: se só existe uma, é ela (o holerite costuma cadastrar sem o final).
    if !cartao && candidatas.len() == 1 && candidatas[0]["final"].as_str().is_none_or(|f| f.chars().all(|c| !c.is_ascii_digit())) {
        return candidatas[0]["id"].as_str().map(String::from);
    }
    None
}

/// Instituições cuja conta é tratada como reserva quando aparece pela primeira vez (dá para mudar no app).
fn e_reserva_por_padrao(instituicao: &str) -> bool {
    let i = instituicao.to_lowercase();
    i.contains("mercado pago") || i.contains("mercadopago")
}

#[cfg(test)]
pub fn conta_nova(conta: &Value) -> Value {
    conta_nova_de(conta, "")
}

/// Nome do banco da conta. Pelo MeuPluggy o conector se chama "MeuPluggy" para todos; o banco
/// vem no nome da conta (ex.: "Banco Santander Pessoa Física").
pub fn instituicao_da_conta(conta: &Value, do_item: &str) -> String {
    if !do_item.is_empty() && !do_item.to_lowercase().contains("pluggy") {
        return do_item.to_string();
    }
    let nome = conta["name"].as_str().unwrap_or("").to_lowercase();
    const CONHECIDOS: [(&str, &str); 12] = [
        ("mercado pago", "Mercado Pago"),
        ("mercadopago", "Mercado Pago"),
        ("santander", "Santander"),
        ("nubank", "Nubank"),
        ("nu pagamentos", "Nubank"),
        ("itau", "Itaú"),
        ("itaú", "Itaú"),
        ("bradesco", "Bradesco"),
        ("banco inter", "Inter"),
        ("caixa", "Caixa"),
        ("banco do brasil", "Banco do Brasil"),
        ("picpay", "PicPay"),
    ];
    CONHECIDOS.iter().find(|(k, _)| nome.contains(k)).map(|(_, v)| v.to_string()).unwrap_or_default()
}

/// Conta nova com o nome da instituição e o papel inicial.
pub fn conta_nova_de(conta: &Value, instituicao: &str) -> Value {
    let mut c = conta_nova_base(conta);
    if !instituicao.is_empty() {
        c["instituicao"] = json!(instituicao);
        if c["tipo"] == "corrente" && e_reserva_por_padrao(instituicao) {
            c["papel"] = json!("reserva");
        }
    }
    c
}

fn conta_nova_base(conta: &Value) -> Value {
    let cartao = conta["type"].as_str() == Some("CREDIT");
    let fim = final4(conta["number"].as_str().unwrap_or(""));
    let nome = conta["name"].as_str().unwrap_or("Conta").split_whitespace().collect::<Vec<_>>().join(" ");
    json!({
        "id": format!("{}-{}", if cartao { "cartao" } else { "corrente" }, if fim.is_empty() { "pluggy".to_string() } else { fim.clone() }),
        "instituicao": "Open Finance (Pluggy)",
        "tipo": if cartao { "cartao" } else { "corrente" },
        "apelido": nome,
        "final": fim,
        "pluggy_id": conta["id"],
    })
}

/// Último mês já coberto por documento enviado em arquivo nesta conta.
pub fn corte_documentos(movs: &Value, conta_id: &str) -> Option<String> {
    movs["movimentacoes"]
        .as_array()?
        .iter()
        .filter(|m| m["conta_id"].as_str() == Some(conta_id) && m["origem"]["documento_id"].as_str().is_some() && m["origem"]["fonte"].as_str() != Some("pluggy"))
        .filter_map(|m| m["competencia"].as_str().or_else(|| m["data"].as_str().map(|d| &d[..7])).map(String::from))
        .max()
}

#[derive(Debug, Default, PartialEq, serde::Serialize)]
pub struct Contagem {
    pub novas: usize,
    pub atualizadas: usize,
    pub removidas: usize,
    pub cobertas_por_documento: usize,
    pub ignoradas: usize,
}

/// Desfaz, em `emprestimos.json`, os pagamentos de lançamentos que a sincronização removeu.
/// O que já não existe é ignorado.
pub fn desfazer_pagamentos_sumidos(emprestimos: &mut Value, sumidos: &[(String, String)], agora: &str) {
    for (id, pid) in sumidos {
        let _ = crate::emprestimos::remover_pagamento(emprestimos, id, pid, agora);
    }
}

/// Desfaz, em `dividas.json`, os pagamentos de lançamentos ligados a dívidas que a
/// sincronização removeu. O que já não existe é ignorado.
pub fn desfazer_pagamentos_de_dividas_sumidos(dividas: &mut Value, sumidos: &[(String, String, Value)]) {
    for (id, lid, antes) in sumidos {
        let _ = crate::dividas::desfazer_pagamento(dividas, id, lid, antes);
    }
}

/// Junta as movimentações convertidas de uma conta da Pluggy na lista atual.
/// `desde`: início da janela consultada; lançamentos desta conta da Pluggy na janela que não
/// vieram de novo são removidos.
pub fn mesclar(movs: &mut Value, pluggy_conta: &str, novas: Vec<Value>, desde: &str, corte: Option<&str>) -> Contagem {
    let mut ct = Contagem::default();
    if !movs.is_object() {
        *movs = json!({ "schema_version": 1 });
    }
    if !movs["movimentacoes"].is_array() {
        movs["movimentacoes"] = json!([]);
    }
    let lista = movs["movimentacoes"].as_array_mut().unwrap();
    let mut vistos = HashSet::new();
    let pos: HashMap<String, usize> = lista.iter().enumerate().filter_map(|(i, m)| Some((m["id"].as_str()?.to_string(), i))).collect();
    let mut acrescentar = Vec::new();
    for mut m in novas {
        let id = m["id"].as_str().unwrap_or_default().to_string();
        vistos.insert(id.clone());
        if corte.is_some_and(|c| m["competencia"].as_str().is_some_and(|comp| comp <= c)) {
            ct.cobertas_por_documento += 1;
            continue;
        }
        match pos.get(&id) {
            Some(&i) => {
                // A categoria é decidida na primeira vez (ou por você) e não muda mais sozinha;
                // só o que ainda está "a classificar" ganha nova chance.
                let antigo = &lista[i];
                // O que você escreveu (nome, quem, partes, vínculo, detalhe antigo) nunca é
                // apagado pela sincronização.
                // Se o banco mudou o valor (pendente que fechou diferente), as partes não somam
                // mais: são descartadas; a categoria principal e o vínculo ficam (o pagamento
                // registrado para uma pessoa fica para você decidir).
                let valor_mudou = r2(antigo["valor"].as_f64().unwrap_or(0.0)) != r2(m["valor"].as_f64().unwrap_or(0.0));
                for campo in crate::lancamentos::CAMPOS_DO_USUARIO {
                    if campo == "partes" && valor_mudou {
                        continue;
                    }
                    if let Some(v) = antigo.get(campo).filter(|v| !v.is_null()) {
                        m[campo] = v.clone();
                    }
                }
                // Lançamento dividido em partes também guarda a classificação, mesmo com uma
                // parte pendente: as partes dependem da natureza e definem a categoria.
                let com_partes = antigo.get("partes").is_some_and(|p| p.as_array().is_some_and(|l| !l.is_empty()));
                if com_partes || antigo["categoria"].as_str().is_some_and(|c| c != "a_classificar") {
                    for campo in ["natureza", "categoria", "subcategoria", "classificacao", "recorrencia"] {
                        match antigo.get(campo) {
                            Some(v) => m[campo] = v.clone(),
                            None => {
                                if let Some(o) = m.as_object_mut() {
                                    o.remove(campo);
                                }
                            }
                        }
                    }
                }
                if lista[i] != m {
                    lista[i] = m;
                    ct.atualizadas += 1;
                }
            }
            None => {
                acrescentar.push(m);
                ct.novas += 1;
            }
        }
    }
    let antes = lista.len();
    lista.retain(|m| {
        let desta = m["origem"]["fonte"].as_str() == Some("pluggy") && m["origem"]["pluggy_conta"].as_str() == Some(pluggy_conta);
        let na_janela = m["data"].as_str().is_some_and(|d| d >= desde);
        !(desta && na_janela && !vistos.contains(m["id"].as_str().unwrap_or_default()))
    });
    ct.removidas = antes - lista.len();
    lista.extend(acrescentar);
    lista.sort_by(|a, b| a["data"].as_str().cmp(&b["data"].as_str()));
    ct
}

fn fim_do_mes(comp: &str) -> String {
    let (a, m): (i32, u32) = (comp[..4].parse().unwrap_or(2000), comp[5..7].parse().unwrap_or(1));
    let prox = if m == 12 { NaiveDate::from_ymd_opt(a + 1, 1, 1) } else { NaiveDate::from_ymd_opt(a, m + 1, 1) };
    prox.map(|d| (d - chrono::Duration::days(1)).to_string()).unwrap_or_else(|| format!("{comp}-28"))
}

/// Saldo da conta no fim de cada mês, do primeiro mês com lançamentos do banco até hoje:
/// saldo de hoje menos tudo o que entrou/saiu depois do fim daquele mês. Lançamentos feitos
/// à mão ficam de fora: o saldo informado pelo banco não os conhece.
pub fn saldos_mensais(movs: &Value, conta_id: &str, saldo_hoje: f64, hoje: NaiveDate) -> Vec<(String, f64)> {
    let l: Vec<(&str, f64)> = movs["movimentacoes"]
        .as_array()
        .map(|l| {
            l.iter()
                .filter(|m| m["conta_id"].as_str() == Some(conta_id) && m["origem"]["manual"].as_bool() != Some(true))
                .filter_map(|m| Some((m["data"].as_str()?, m["valor"].as_f64()?)))
                .collect()
        })
        .unwrap_or_default();
    let primeira = movs["movimentacoes"]
        .as_array()
        .and_then(|l| {
            l.iter()
                .filter(|m| m["conta_id"].as_str() == Some(conta_id) && m["origem"]["fonte"].as_str() == Some("pluggy"))
                .filter_map(|m| m["data"].as_str())
                .min()
        })
        .map(|d| d[..7].to_string());
    let Some(mut comp) = primeira else { return vec![] };
    let hoje_txt = hoje.to_string();
    let hoje_comp = hoje_txt[..7].to_string();
    let mut out = Vec::new();
    while comp <= hoje_comp {
        let fim = fim_do_mes(&comp);
        let depois: f64 = l.iter().filter(|(d, _)| *d > fim.as_str() && *d <= hoje_txt.as_str()).map(|(_, v)| v).sum();
        out.push((comp.clone(), r2(saldo_hoje - depois)));
        let (a, m): (i32, u32) = (comp[..4].parse().unwrap(), comp[5..7].parse().unwrap());
        comp = if m == 12 { format!("{}-01", a + 1) } else { format!("{a}-{:02}", m + 1) };
    }
    out
}

fn gravar_saldos_mensais(movs: &mut Value, conta_id: &str, saldo_hoje: f64, hoje: NaiveDate) {
    let calculados = saldos_mensais(movs, conta_id, saldo_hoje, hoje);
    if !movs["saldos"].is_array() {
        movs["saldos"] = json!([]);
    }
    let hoje_comp = hoje.format("%Y-%m").to_string();
    let s = movs["saldos"].as_array_mut().unwrap();
    for (comp, valor) in calculados {
        let pos = s.iter().position(|e| e["conta_id"].as_str() == Some(conta_id) && e["competencia"].as_str() == Some(comp.as_str()));
        // Saldo que veio de extrato enviado em arquivo continua valendo.
        if pos.is_some_and(|i| s[i]["origem"]["fonte"].as_str() != Some("pluggy")) {
            continue;
        }
        let data = if comp == hoje_comp { hoje.to_string() } else { fim_do_mes(&comp) };
        let novo = json!({ "conta_id": conta_id, "competencia": comp, "saldo_final": valor, "data": data, "status": "confirmado", "origem": { "fonte": "pluggy" } });
        match pos {
            Some(i) => s[i] = novo,
            None => s.push(novo),
        }
    }
    s.sort_by(|a, b| (a["conta_id"].as_str(), a["competencia"].as_str()).cmp(&(b["conta_id"].as_str(), b["competencia"].as_str())));
}

/// Atualiza (ou cria) a dívida do cartão com o limite usado informado pelo banco, um registro por mês.
pub fn atualizar_divida_cartao(dividas: &mut Value, conta_id: &str, apelido: &str, usado: f64, fatura: Option<f64>, hoje: NaiveDate) {
    if !dividas.is_object() {
        *dividas = json!({ "schema_version": 1 });
    }
    if !dividas["dividas"].is_array() {
        dividas["dividas"] = json!([]);
    }
    let l = dividas["dividas"].as_array_mut().unwrap();
    let i = match l.iter().position(|d| d["conta_id"].as_str() == Some(conta_id) && d["tipo"].as_str().is_some_and(|t| t.starts_with("cartao"))) {
        Some(i) => i,
        None => {
            l.push(json!({ "id": format!("divida-{conta_id}"), "credor": apelido, "tipo": "cartao_de_credito", "conta_id": conta_id, "taxa_mensal": null, "situacao": "ativa", "saldos": [] }));
            l.len() - 1
        }
    };
    let d = &mut l[i];
    if !d["saldos"].is_array() {
        d["saldos"] = json!([]);
    }
    let comp = hoje.format("%Y-%m").to_string();
    let saldos = d["saldos"].as_array_mut().unwrap();
    // Um registro do banco por mês (o mais recente); os das faturas em PDF ficam.
    saldos.retain(|s| !(s["origem"]["fonte"].as_str() == Some("pluggy") && s["data"].as_str().is_some_and(|x| x.starts_with(&comp))));
    saldos.push(json!({ "data": hoje.to_string(), "saldo_devedor": usado, "fatura_aberta": fatura, "status": "confirmado", "origem": { "fonte": "pluggy" } }));
    saldos.sort_by(|a, b| a["data"].as_str().cmp(&b["data"].as_str()));
}

fn tem_lancamentos_da_pluggy(movs: &Value, pluggy_conta: &str) -> bool {
    movs["movimentacoes"].as_array().is_some_and(|l| {
        l.iter().any(|m| m["origem"]["fonte"].as_str() == Some("pluggy") && m["origem"]["pluggy_conta"].as_str() == Some(pluggy_conta))
    })
}

/// Executa uma sincronização completa. `dias`: janela forçada; `None` = automática
/// (um ano na primeira vez de cada conta, depois `DIAS_DIARIA`).
pub async fn sincronizar(arm: &Armazenamento, p: &Pluggy, hoje: NaiveDate, agora: &str, dias: Option<i64>) -> Result<Value> {
    let mut cfg = arm.ler_json("config").await?;
    let mut movs = arm.ler_json("movimentacoes").await?;
    let mut dividas = arm.ler_json("dividas").await?;
    let dividas_antes = dividas.clone();
    let cfg_antes = cfg.clone();
    let movs_antes = movs.clone();
    let cats = arm.ler_json("categorias").await?;
    let regras = Classificador::novo(&movs).sem(crate::categorias::ocultas(&cats)).com_grupos(&cats);
    if !cfg.is_object() {
        cfg = json!({ "schema_version": 1 });
    }
    if !cfg["contas"].is_array() {
        cfg["contas"] = json!([]);
    }

    let mut relatorio_contas = Vec::new();
    let mut conexoes = Vec::new();
    let mut falhas = Vec::new();
    for item_id in &p.item_ids {
        // Uma conexão com problema não impede as outras de sincronizar.
        let lido = async { Ok::<_, anyhow::Error>((p.item(item_id).await?, p.contas(item_id).await?)) }.await;
        let (item, contas) = match lido {
            Ok(x) => x,
            Err(e) => {
                falhas.push(format!("{e:#}"));
                conexoes.push(json!({ "item": item_id, "erro": format!("{e:#}") }));
                continue;
            }
        };
        let instituicao = item["connector"]["name"].as_str().unwrap_or("").to_string();
        let nome_conexao = contas.iter().map(|c| instituicao_da_conta(c, &instituicao)).find(|b| !b.is_empty()).unwrap_or_else(|| instituicao.clone());
        conexoes.push(resumo_conexao(&item, &nome_conexao));
        for conta in &contas {
            let pid = conta["id"].as_str().unwrap_or_default().to_string();
            let n = dias.unwrap_or(if tem_lancamentos_da_pluggy(&movs, &pid) { DIAS_DIARIA } else { DIAS_PRIMEIRA });
            let de = hoje - chrono::Duration::days(n.clamp(1, 366));
            // Um dia a mais: datas em UTC podem cair no dia seguinte.
            let banco = instituicao_da_conta(conta, &instituicao);
            let txs = match p.transacoes(&pid, de, hoje + chrono::Duration::days(1)).await {
                Ok(t) => t,
                Err(e) => {
                    falhas.push(format!("{e:#}"));
                    relatorio_contas.push(json!({ "conta": conta["name"], "erro": format!("{e:#}") }));
                    continue;
                }
            };
            let nome = conta["name"].as_str().unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" ");

            let conta_id = match conta_vinculada(&cfg, conta) {
                Some(id) => id,
                None if txs.is_empty() => {
                    relatorio_contas.push(json!({ "conta": nome, "situacao": "sem lançamentos no período; não foi cadastrada" }));
                    continue;
                }
                None => {
                    let c = conta_nova_de(conta, &banco);
                    let id = c["id"].as_str().unwrap_or_default().to_string();
                    cfg["contas"].as_array_mut().unwrap().push(c);
                    id
                }
            };
            if let Some(c) = cfg["contas"].as_array_mut().unwrap().iter_mut().find(|c| c["id"].as_str() == Some(conta_id.as_str())) {
                if c["pluggy_id"].as_str() != Some(pid.as_str()) {
                    c["pluggy_id"] = json!(pid);
                }
            }

            let mut convertidas = Vec::new();
            let mut ignoradas = 0;
            for t in &txs {
                match converter(conta, t, &conta_id, &regras) {
                    Some(m) => convertidas.push(m),
                    None => ignoradas += 1,
                }
            }
            let corte = corte_documentos(&movs, &conta_id);
            let mut ct = mesclar(&mut movs, &pid, convertidas, &de.to_string(), corte.as_deref());
            ct.ignoradas = ignoradas;

            // Conta corrente: saldo no fim de cada mês, reconstruído a partir do saldo atual.
            let saldo = conta["balance"].as_f64().map(r2);
            if conta["type"].as_str() == Some("BANK") {
                if let Some(atual) = saldo {
                    gravar_saldos_mensais(&mut movs, &conta_id, atual, hoje);
                }
            }
            // Cartão: limite usado (fatura aberta + parcelas a vencer) vira o saldo devedor do mês.
            let cd = &conta["creditData"];
            let usado = match (cd["creditLimit"].as_f64(), cd["availableCreditLimit"].as_f64()) {
                (Some(l), Some(d)) if l > 0.0 => Some(r2(l - d)),
                _ => saldo,
            };
            if conta["type"].as_str() == Some("CREDIT") {
                if let Some(u) = usado {
                    let apelido = cfg["contas"].as_array().and_then(|l| l.iter().find(|c| c["id"].as_str() == Some(conta_id.as_str()))).and_then(|c| c["apelido"].as_str()).unwrap_or(&nome).to_string();
                    atualizar_divida_cartao(&mut dividas, &conta_id, &apelido, u, saldo, hoje);
                }
            }
            // Faturas fechadas, com o valor exato do banco. Se a Pluggy falhar aqui, a sincronização segue sem elas.
            let faturas = if conta["type"].as_str() == Some("CREDIT") {
                match p.faturas(&pid).await {
                    Ok(v) => resumir_faturas(&v),
                    Err(e) => {
                        tracing::warn!("faturas do cartão {nome}: {e:#}");
                        Value::Null
                    }
                }
            } else {
                Value::Null
            };
            let papel = cfg["contas"].as_array().and_then(|l| l.iter().find(|c| c["id"].as_str() == Some(conta_id.as_str()))).map(|c| c["papel"].clone()).unwrap_or(Value::Null);
            relatorio_contas.push(json!({
                "conta": nome,
                "conta_id": conta_id,
                "instituicao": banco,
                "papel": papel,
                "tipo": if conta["type"].as_str() == Some("CREDIT") { "cartao" } else { "corrente" },
                "saldo": saldo,
                "limite": cd["creditLimit"],
                "limite_usado": if conta["type"].as_str() == Some("CREDIT") { json!(usado) } else { Value::Null },
                "vencimento": cd["balanceDueDate"],
                "fechamento": cd["balanceCloseDate"],
                "faturas": faturas,
                "periodo": [de.to_string(), hoje.to_string()],
                "recebidas": txs.len(),
                "ate_mes_coberto_por_documento": corte,
                "contagem": ct,
            }));
        }
    }
    if conexoes.iter().all(|c| !c["erro"].is_null()) {
        bail!("nenhuma conexão respondeu: {}", falhas.join(" · "));
    }

    // Mesmo valor saindo de uma conta sua e entrando em outra: transferência entre contas.
    let transferencias = casar_transferencias(&mut movs, &cfg);

    // Só grava o que mudou: a sincronização diária não deve gastar o histórico de versões à toa.
    let mut sem_carimbo = movs.clone();
    sem_carimbo["atualizado_em"] = movs_antes["atualizado_em"].clone();
    let gravou_movs = sem_carimbo != movs_antes;
    // Lançamentos ligados a uma pessoa ou dívida que a sincronização removeu: desfaz o pagamento
    // deles (gravado antes de movimentacoes). A marca de uma fixa fica como está.
    desfazer_pagamentos_de_dividas_sumidos(&mut dividas, &crate::lancamentos::pagamentos_de_dividas_sumidos(&movs_antes, &movs));
    let gravou_dividas = dividas != dividas_antes;
    if gravou_dividas {
        dividas["atualizado_em"] = json!(agora);
        arm.gravar_valor("dividas", &dividas).await?;
    }
    let sumidos = crate::lancamentos::pagamentos_sumidos(&movs_antes, &movs);
    if !sumidos.is_empty() {
        let mut emprestimos = arm.ler_json("emprestimos").await?;
        let emprestimos_antes = emprestimos.clone();
        desfazer_pagamentos_sumidos(&mut emprestimos, &sumidos, agora);
        if emprestimos != emprestimos_antes {
            arm.gravar_valor("emprestimos", &emprestimos).await?;
        }
    }
    if gravou_movs {
        movs["atualizado_em"] = json!(agora);
        arm.gravar_valor("movimentacoes", &movs).await?;
    }
    let gravou_cfg = cfg != cfg_antes;
    if gravou_cfg {
        cfg["atualizado_em"] = json!(agora);
        arm.gravar_valor("config", &cfg).await?;
    }
    Ok(json!({
        "em": agora,
        "ok": true,
        // A primeira conexão, como antes; todas em `conexoes`.
        "conexao": conexoes.iter().find(|c| c["erro"].is_null()).cloned().unwrap_or(Value::Null),
        "conexoes": conexoes,
        "falhas": falhas,
        "transferencias_entre_contas": transferencias,
        "contas": relatorio_contas,
        "gravou": gravou_movs || gravou_cfg || gravou_dividas,
    }))
}

fn resumo_conexao(item: &Value, instituicao: &str) -> Value {
    json!({
        "item": item["id"],
        "instituicao": instituicao,
        "status": item["status"],
        "execucao": item["executionStatus"],
        "atualizada_na_pluggy_em": item["lastUpdatedAt"],
        "proxima_atualizacao_automatica": item["nextAutoSyncAt"],
        "consentimento_ate": item["consentExpiresAt"],
        "erro_conexao": item["error"]["message"],
    })
}

/// Junta pares de lançamentos entre duas contas correntes suas: o mesmo valor saindo de uma e
/// entrando na outra em até 2 dias. Os dois viram transferência interna (fora de receitas e
/// despesas) e apontam um para o outro. Não mexe no que você classificou à mão nem no que já
/// é transferência, aporte, resgate ou pagamento de fatura, nem em lançamentos feitos à mão.
/// Devolve quantos pares juntou.
pub fn casar_transferencias(movs: &mut Value, cfg: &Value) -> usize {
    let correntes: std::collections::HashSet<String> = cfg["contas"]
        .as_array()
        .map(|l| l.iter().filter(|c| c["tipo"].as_str().is_some_and(|t| t.contains("corrente"))).filter_map(|c| c["id"].as_str().map(String::from)).collect())
        .unwrap_or_default();
    if correntes.len() < 2 {
        return 0;
    }
    let Some(l) = movs.get_mut("movimentacoes").and_then(Value::as_array_mut) else { return 0 };
    let dia = |m: &Value| NaiveDate::parse_from_str(m["data"].as_str().unwrap_or(""), "%Y-%m-%d").ok();
    let livre = |m: &Value| {
        m["conta_id"].as_str().is_some_and(|c| correntes.contains(c))
            && matches!(m["natureza"].as_str(), Some("despesa" | "receita"))
            && m["classificacao"] != "manual"
            && m["origem"]["manual"].as_bool() != Some(true)
            && m["status"] != "pendente"
            && dia(m).is_some()
    };
    let cent = |m: &Value| (m["valor"].as_f64().unwrap_or(0.0) * 100.0).round() as i64;
    let mut saidas: Vec<usize> = (0..l.len()).filter(|&i| livre(&l[i]) && cent(&l[i]) < 0).collect();
    saidas.sort_by_key(|&i| dia(&l[i]));
    let mut usados = std::collections::HashSet::new();
    let mut pares = Vec::new();
    for i in saidas {
        let (di, ci, vi) = (dia(&l[i]).unwrap(), l[i]["conta_id"].clone(), cent(&l[i]));
        let melhor = (0..l.len())
            .filter(|&j| !usados.contains(&j) && livre(&l[j]) && l[j]["conta_id"] != ci && cent(&l[j]) == -vi)
            .filter_map(|j| {
                let d = (dia(&l[j]).unwrap() - di).num_days().abs();
                (d <= 2).then_some((d, j))
            })
            .min();
        if let Some((_, j)) = melhor {
            usados.insert(j);
            pares.push((i, j));
        }
    }
    for &(i, j) in &pares {
        for (a, b) in [(i, j), (j, i)] {
            let outro = l[b]["id"].clone();
            let m = &mut l[a];
            m["natureza"] = json!("transferencia_interna");
            m["categoria"] = json!("transferencias");
            m["subcategoria"] = json!("entre suas contas");
            m["classificacao"] = json!("alta");
            m["conciliado_com"] = json!({ "tipo": "movimentacao", "id": outro });
        }
    }
    pares.len()
}

/// Guarda o resultado de uma execução em `sincronizacoes` (as últimas 60).
pub async fn registrar(arm: &Armazenamento, execucao: Value, agora: &str) -> Result<()> {
    let mut doc = arm.ler_json("sincronizacoes").await?;
    if !doc.is_object() {
        doc = json!({ "schema_version": 1 });
    }
    if !doc["execucoes"].is_array() {
        doc["execucoes"] = json!([]);
    }
    let l = doc["execucoes"].as_array_mut().unwrap();
    l.push(execucao);
    if l.len() > EXECUCOES_GUARDADAS {
        let sobra = l.len() - EXECUCOES_GUARDADAS;
        l.drain(..sobra);
    }
    doc["atualizado_em"] = json!(agora);
    arm.gravar_valor("sincronizacoes", &doc).await
}

/// Faturas fechadas da Pluggy (`GET /bills`) em `{fechamento, vencimento, total, minimo}`, da mais
/// recente para a mais antiga, só as 6 últimas. `total` negativo = crédito a favor no cartão.
pub fn resumir_faturas(v: &Value) -> Value {
    let dia = |x: &Value| x.as_str().filter(|s| s.len() >= 10).map(|s| s[..10].to_string());
    let mut l: Vec<Value> = v["results"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|b| {
            let venc = dia(&b["dueDate"])?;
            let total = b["totalAmount"].as_f64()?;
            Some(json!({ "fechamento": dia(&b["billClosingDate"]), "vencimento": venc, "total": r2(total), "minimo": b["minimumPaymentAmount"].as_f64().map(r2) }))
        })
        .collect();
    l.sort_by(|a, b| b["vencimento"].as_str().cmp(&a["vencimento"].as_str()));
    l.truncate(6);
    json!(l)
}

#[cfg(test)]
mod testes {
    use super::*;

    fn regras() -> Classificador {
        Classificador::novo(&json!({ "movimentacoes": [
            { "descricao": "LOJA ENSINADA", "categoria": "lazer", "classificacao": "manual" }
        ]}))
    }
    fn corrente() -> Value {
        json!({ "id": "acc-banco", "type": "BANK", "number": "01.001111-0", "name": "Conta Exemplo" })
    }
    fn cartao() -> Value {
        json!({ "id": "acc-cartao", "type": "CREDIT", "number": "1234", "name": "CARTAO EXEMPLO   " })
    }

    #[test]
    fn data_em_horario_de_brasilia() {
        assert_eq!(data_brasilia("2026-11-09T03:00:00.000Z").as_deref(), Some("2026-11-09"));
        assert_eq!(data_brasilia("2026-11-09T02:59:00.000Z").as_deref(), Some("2026-11-08"));
        assert_eq!(data_brasilia("lixo"), None);
    }

    #[test]
    fn descricao_do_debito_vira_nome_da_loja() {
        let t = json!({ "description": "DEBITO VISA ELECTRON BRASIL", "descriptionRaw": "DEBITO VISA ELECTRON BRASIL   09/11 LANCHONETE  DO ZE" });
        assert_eq!(descricao(&t), "LANCHONETE DO ZE");
        let t = json!({ "description": "PIX ENVIADO   Fulano", "descriptionRaw": null });
        assert_eq!(descricao(&t), "PIX ENVIADO Fulano");
    }

    #[test]
    fn compra_no_debito_usa_categoria_da_pluggy() {
        let t = json!({ "id": "t1", "amount": -42.5, "date": "2026-11-09T15:00:00.000Z", "status": "POSTED", "type": "DEBIT",
            "description": "DEBITO VISA ELECTRON BRASIL", "descriptionRaw": "DEBITO VISA ELECTRON BRASIL 09/11 ARMAZEM X", "category": "Groceries", "operationType": "CARTAO" });
        let m = converter(&corrente(), &t, "corrente-exemplo", &regras()).unwrap();
        assert_eq!(m["valor"], -42.5);
        assert_eq!(m["natureza"], "despesa");
        assert_eq!(m["categoria"], "mercado");
        assert_eq!(m["competencia"], "2026-11");
        assert_eq!(m["status"], "confirmado");
        assert_eq!(m["id"], "pluggy-t1");
    }

    #[test]
    fn faturas_fechadas_da_mais_recente_para_a_mais_antiga() {
        let v = json!({ "results": [
            { "dueDate": "2026-10-07T00:00:00.000Z", "billClosingDate": "2026-09-30T00:00:00.000Z", "totalAmount": 1890.73, "minimumPaymentAmount": 221.1 },
            { "dueDate": "2026-11-07T00:00:00.000Z", "billClosingDate": "2026-10-30T00:00:00.000Z", "totalAmount": 2095.914, "minimumPaymentAmount": null },
            { "dueDate": null, "totalAmount": 1.0 }
        ] });
        let l = resumir_faturas(&v);
        assert_eq!(l, json!([
            { "fechamento": "2026-10-30", "vencimento": "2026-11-07", "total": 2095.91, "minimo": null },
            { "fechamento": "2026-09-30", "vencimento": "2026-10-07", "total": 1890.73, "minimo": 221.1 }
        ]));
        assert_eq!(resumir_faturas(&json!({})), json!([]));
    }

    #[test]
    fn cartao_inverte_sinal_e_usa_fatura_prevista() {
        let t = json!({ "id": "t2", "amount": 159.2, "date": "2026-10-30T03:00:00.000Z", "status": "PENDING", "type": "DEBIT",
            "description": "LOJA ENSINADA", "category": "Shopping", "operationType": "PAGAMENTO",
            "creditCardMetadata": { "billForecastDate": "2026-11", "installmentNumber": 2, "totalInstallments": 10, "purchaseDate": "2026-09-30T15:00:00.000Z" } });
        let m = converter(&cartao(), &t, "cartao-exemplo-1234", &regras()).unwrap();
        assert_eq!(m["valor"], -159.2);
        assert_eq!(m["competencia"], "2026-11");
        assert_eq!(m["status"], "pendente");
        assert_eq!(m["parcela"], "02/10");
        assert_eq!(m["data_compra"], "2026-09-30");
        // O que você ensinou vence a categoria da Pluggy.
        assert_eq!(m["categoria"], "lazer");
    }

    #[test]
    fn pagamento_de_fatura_e_transferencia_interna_dos_dois_lados() {
        let no_cartao = json!({ "id": "t3", "amount": -2095.91, "date": "2026-11-06T12:00:00.000Z", "status": "POSTED", "type": "CREDIT",
            "description": "PAGAMENTO DE FATURA", "category": "Credit card payment", "operationType": "PAGAMENTO", "creditCardMetadata": { "billForecastDate": "2026-11" } });
        let m = converter(&cartao(), &no_cartao, "c", &regras()).unwrap();
        assert_eq!((m["natureza"].as_str(), m["valor"].as_f64()), (Some("transferencia_interna"), Some(2095.91)));
        let na_conta = json!({ "id": "t4", "amount": -2095.91, "date": "2026-11-06T12:00:00.000Z", "status": "POSTED", "type": "DEBIT",
            "description": "PAGAMENTO CARTAO CREDITO", "category": "Credit card payment", "operationType": "CARTAO" });
        assert_eq!(converter(&corrente(), &na_conta, "b", &regras()).unwrap()["natureza"], "transferencia_interna");
    }

    #[test]
    fn salario_rendimento_e_emprestimo() {
        let base = |id: &str, amount: f64, cat: &str, op: &str| {
            json!({ "id": id, "amount": amount, "date": "2026-11-05T12:00:00.000Z", "status": "POSTED", "description": "X", "category": cat, "operationType": op })
        };
        let r = regras();
        assert_eq!(converter(&corrente(), &base("a", 3000.0, "Salary", "FOLHA_PAGAMENTO"), "b", &r).unwrap()["categoria"], "salario");
        assert_eq!(converter(&corrente(), &base("b", 0.02, "Proceeds interests and dividends", "RENDIMENTO_APLIC_FINANCEIRA"), "b", &r).unwrap()["categoria"], "investimentos");
        assert_eq!(converter(&corrente(), &base("c", 4000.0, "Loans and financing", "OPERACAO_CREDITO"), "b", &r).unwrap()["natureza"], "emprestimo_recebido");
        let pix = converter(&corrente(), &base("d", -50.0, "Transfer - PIX", "PIX"), "b", &r).unwrap();
        assert_eq!((pix["natureza"].as_str(), pix["categoria"].as_str()), (Some("despesa"), Some("transferencias")));
    }

    #[test]
    fn migrado_grava_grupos_e_mantem_outras_naturezas() {
        let mut cats = json!({});
        let mut movs = json!({ "movimentacoes": [] });
        crate::categorias::migrar(&mut cats, &mut movs, &[], "2026-11-19T10:00:00-03:00").unwrap();
        let mut com_mercado = cats.clone();
        com_mercado["mapa"]["mercado"] = json!("p_mercado");
        com_mercado["grupos"].as_array_mut().unwrap().push(json!({ "id": "p_mercado", "nome": "Mercado", "tipo": "gasto", "cor": "g1", "detalhes": [], "pede_pessoa": false, "padrao": false }));
        let r = Classificador::novo(&json!({ "movimentacoes": [{ "descricao": "LOJA SALARIO", "categoria": "salario", "classificacao": "manual" }] })).com_grupos(&com_mercado);
        let base = |id: &str, amount: f64, cat: &str, op: &str, desc: &str| {
            json!({ "id": id, "amount": amount, "date": "2026-11-05T12:00:00.000Z", "status": "POSTED", "description": desc, "category": cat, "operationType": op })
        };
        let c = |conta: &Value, t: Value| converter(conta, &t, "b", &r).unwrap();
        let sal = c(&corrente(), base("a", 3000.0, "Salary", "FOLHA_PAGAMENTO", "X"));
        assert_eq!(sal["categoria"], "salario");
        let rend = c(&corrente(), base("b", 0.02, "Proceeds interests and dividends", "RENDIMENTO_APLIC_FINANCEIRA", "X"));
        assert_eq!((rend["natureza"].as_str(), rend["categoria"].as_str(), rend["subcategoria"].as_str()), (Some("receita"), Some("rendimentos_estornos"), Some("Rendimentos")));
        let outra = c(&corrente(), base("c", 80.0, "", "", "CREDITO X"));
        assert_eq!(outra["categoria"], "outras_entradas");
        let aporte = c(&corrente(), base("d", -500.0, "", "", "APLICACAO CDB"));
        assert_eq!((aporte["natureza"].as_str(), aporte["categoria"].as_str()), (Some("aporte_investimento"), Some("investimentos")));
        let emp = c(&corrente(), base("e", 4000.0, "Loans and financing", "OPERACAO_CREDITO", "X"));
        assert_eq!(emp["categoria"], "emprestimos");
        let pix = c(&corrente(), base("f", -50.0, "Transfer - PIX", "PIX", "PIX ENVIADO"));
        assert_eq!((pix["categoria"].as_str(), pix["subcategoria"].as_str()), (Some("outros"), Some("Transferências")), "Pix enviado na conta");
        let ted = c(&corrente(), base("f2", -70.0, "Transfer - TED", "TED", "TED FULANO"));
        assert_eq!((ted["categoria"].as_str(), ted["subcategoria"].as_str()), (Some("outros"), Some("Transferências")));
        let pix_cartao = c(&cartao(), base("f3", 50.0, "Transfer - PIX", "", "PIX FULANO"));
        assert_eq!((pix_cartao["categoria"].as_str(), pix_cartao["subcategoria"].as_str()), (Some("outros"), Some("Pix no cartão")));
        let posto = c(&corrente(), base("f4", -90.0, "Gas stations", "CARTAO", "POSTO SHELL"));
        assert_eq!((posto["categoria"].as_str(), posto["subcategoria"].as_str(), posto["classificacao"].as_str()), (Some("a_classificar"), None, Some("baixa")));
        let mercado = c(&corrente(), base("g", -42.5, "Groceries", "CARTAO", "ARMAZEM X"));
        assert_eq!(mercado["categoria"], "p_mercado");
        let estorno = c(&cartao(), base("h", -30.0, "", "", "LOJA X"));
        assert_eq!((estorno["natureza"].as_str(), estorno["categoria"].as_str(), estorno["subcategoria"].as_str()), (Some("estorno"), Some("rendimentos_estornos"), Some("Estorno")));
        let aprendido = c(&corrente(), base("j", -20.0, "", "", "LOJA SALARIO"));
        assert_eq!(aprendido["categoria"], "a_classificar", "aprendido de entrada não serve para despesa");
        let fatura = c(&cartao(), base("i", -100.0, "Credit card payment", "", "PAGAMENTO DE FATURA"));
        assert_eq!(fatura["categoria"], "pagamento_fatura_cartao");
    }

    #[test]
    fn assinatura_e_fixa_mesmo_sem_grupo() {
        let base = |id: &str, desc: &str, cat: &str| {
            json!({ "id": id, "amount": 39.9, "date": "2026-11-05T12:00:00.000Z", "status": "POSTED", "description": desc, "category": cat, "operationType": "" })
        };
        // Sem migrar, como sempre.
        let m = converter(&cartao(), &base("a", "NETFLIX.COM", ""), "c", &regras()).unwrap();
        assert_eq!((m["categoria"].as_str(), m["recorrencia"].as_str()), (Some("assinaturas"), Some("fixa")));
        // Migrado sem o grupo Assinaturas: vai para "a classificar", mas continua fixa.
        let mut cats = json!({});
        crate::categorias::migrar(&mut cats, &mut json!({ "movimentacoes": [] }), &[], "2026-11-19T10:00:00-03:00").unwrap();
        let r = Classificador::novo(&json!({})).com_grupos(&cats);
        let m = converter(&cartao(), &base("b", "NETFLIX.COM", ""), "c", &r).unwrap();
        assert_eq!((m["categoria"].as_str(), m["recorrencia"].as_str()), (Some("a_classificar"), Some("fixa")));
        let m = converter(&cartao(), &base("c", "LOJA DESCONHECIDA", "Digital services"), "c", &r).unwrap();
        assert_eq!((m["categoria"].as_str(), m["recorrencia"].as_str()), (Some("a_classificar"), Some("fixa")), "pela categoria da Pluggy");
        let m = converter(&cartao(), &base("d", "ARMAZEM X", "Groceries"), "c", &r).unwrap();
        assert_eq!(m["recorrencia"], "variavel");
    }

    #[test]
    fn parcela_futura_projetada_fica_de_fora() {
        let t = json!({ "id": "t5", "amount": 151.21, "date": "2026-11-01T03:00:00.000Z", "status": "PENDING", "description": "MP*LOJA",
            "creditCardMetadata": { "billForecastDate": "0001-01", "installmentNumber": 7, "totalInstallments": 10 } });
        assert!(converter(&cartao(), &t, "c", &regras()).is_none());
    }

    #[test]
    fn vincula_por_final_e_pela_unica_corrente() {
        let cfg = json!({ "contas": [
            { "id": "corrente-exemplo", "tipo": "corrente", "final": "…" },
            { "id": "cartao-exemplo-1234", "tipo": "cartao", "final": "1234" }
        ]});
        assert_eq!(conta_vinculada(&cfg, &cartao()).as_deref(), Some("cartao-exemplo-1234"));
        assert_eq!(conta_vinculada(&cfg, &corrente()).as_deref(), Some("corrente-exemplo"));
        let outro = json!({ "id": "acc-x", "type": "CREDIT", "number": "8120", "name": "SX" });
        assert_eq!(conta_vinculada(&cfg, &outro), None);
        assert_eq!(conta_nova(&outro)["id"], "cartao-8120");
    }

    fn mov(id: &str, data: &str, comp: &str, extra: Value) -> Value {
        let mut m = json!({ "id": id, "conta_id": "c", "data": data, "competencia": comp, "valor": -10.0, "categoria": "compras", "classificacao": "media",
            "origem": { "fonte": "pluggy", "pluggy_conta": "acc" }, "status": "pendente" });
        for (k, v) in extra.as_object().unwrap() {
            m[k] = v.clone();
        }
        m
    }

    #[test]
    fn mescla_atualiza_mantem_manual_remove_sumidos_e_respeita_documentos() {
        let mut movs = json!({ "movimentacoes": [
            // Da fatura em PDF (setembro): continua valendo.
            { "id": "pdf-1", "conta_id": "c", "data": "2026-09-10", "competencia": "2026-09", "valor": -5.0, "origem": { "documento_id": "doc-set" } },
            // Já sincronizado, com categoria escolhida por você.
            mov("pluggy-a", "2026-10-05", "2026-10", json!({ "categoria": "lazer", "classificacao": "manual" })),
            // Pendente que a Pluggy não devolve mais (foi substituído).
            mov("pluggy-sumiu", "2026-10-06", "2026-10", json!({})),
            // Fora da janela consultada: não é tocado.
            mov("pluggy-antigo", "2026-08-01", "2026-08", json!({})),
        ]});
        let corte = corte_documentos(&movs, "c");
        assert_eq!(corte.as_deref(), Some("2026-09"));
        let novas = vec![
            mov("pluggy-a", "2026-10-05", "2026-10", json!({ "status": "confirmado" })),
            mov("pluggy-b", "2026-10-07", "2026-10", json!({})),
            mov("pluggy-set", "2026-09-20", "2026-09", json!({})),
        ];
        let ct = mesclar(&mut movs, "acc", novas, "2026-09-01", corte.as_deref());
        assert_eq!(ct, Contagem { novas: 1, atualizadas: 1, removidas: 1, cobertas_por_documento: 1, ignoradas: 0 });
        let l = movs["movimentacoes"].as_array().unwrap();
        let a = l.iter().find(|m| m["id"] == "pluggy-a").unwrap();
        assert_eq!((a["status"].as_str(), a["categoria"].as_str()), (Some("confirmado"), Some("lazer")));
        assert!(l.iter().any(|m| m["id"] == "pluggy-antigo"));
        assert!(!l.iter().any(|m| m["id"] == "pluggy-sumiu" || m["id"] == "pluggy-set"));
        // Categoria automática já definida também não muda sozinha.
        let mut so_cat = json!({ "movimentacoes": [mov("pluggy-z", "2026-10-05", "2026-10", json!({ "categoria": "mercado", "classificacao": "media" }))] });
        let ct = mesclar(&mut so_cat, "acc", vec![mov("pluggy-z", "2026-10-05", "2026-10", json!({ "categoria": "compras", "classificacao": "alta" }))], "2026-09-01", None);
        assert_eq!(ct, Contagem::default());
        assert_eq!(so_cat["movimentacoes"][0]["categoria"], "mercado");
        // O nome que você deu ao lançamento sobrevive à sincronização, mesmo ainda sem categoria.
        let mut com_nome = json!({ "movimentacoes": [mov("pluggy-n", "2026-10-05", "2026-10", json!({ "categoria": "a_classificar", "nome": "Pix do Thiago: aluguel" }))] });
        mesclar(&mut com_nome, "acc", vec![mov("pluggy-n", "2026-10-05", "2026-10", json!({ "categoria": "a_classificar", "status": "confirmado" }))], "2026-09-01", None);
        assert_eq!(com_nome["movimentacoes"][0]["nome"], "Pix do Thiago: aluguel");
        // Rodar de novo com os mesmos dados não muda nada.
        let antes = movs.clone();
        let de_novo = vec![mov("pluggy-a", "2026-10-05", "2026-10", json!({ "status": "confirmado" })), mov("pluggy-b", "2026-10-07", "2026-10", json!({}))];
        let ct = mesclar(&mut movs, "acc", de_novo, "2026-09-01", corte.as_deref());
        assert_eq!(ct, Contagem::default());
        assert_eq!(movs, antes);
    }

    #[test]
    fn sincronizar_de_novo_preserva_campos_do_usuario() {
        let partes = json!([{ "valor": -6.0, "categoria": "p_comida" }, { "valor": -4.0, "categoria": "a_classificar" }]);
        let vinculo = json!({ "tipo": "pessoa", "id": "emprestimo-1", "pagamento_id": "pg1" });
        let mut movs = json!({ "movimentacoes": [mov("pluggy-u", "2026-10-05", "2026-10", json!({
            "categoria": "a_classificar", "subcategoria": null, "classificacao": "manual", "natureza": "despesa",
            "nome": "Almoço e pão", "quem": "Padaria do bairro", "partes": partes, "vinculo": vinculo, "detalhe_antigo": "padaria"
        }))]});
        let novo = mov("pluggy-u", "2026-10-05", "2026-10", json!({ "categoria": "restaurantes", "classificacao": "alta", "natureza": "despesa", "status": "confirmado" }));
        mesclar(&mut movs, "acc", vec![novo], "2026-09-01", None);
        let m = &movs["movimentacoes"][0];
        assert_eq!(m["status"], "confirmado", "o que vem do banco é atualizado");
        assert_eq!(m["nome"], "Almoço e pão");
        assert_eq!(m["quem"], "Padaria do bairro");
        assert_eq!(m["partes"], partes);
        assert_eq!(m["vinculo"], vinculo);
        assert_eq!(m["detalhe_antigo"], "padaria");
        // Com partes, a categoria acompanha as partes (não é reclassificada sozinha).
        assert_eq!(m["categoria"], "a_classificar");
        // Sem campos do usuário: nada é inventado.
        let mut simples = json!({ "movimentacoes": [mov("pluggy-s", "2026-10-05", "2026-10", json!({ "categoria": "a_classificar" }))] });
        mesclar(&mut simples, "acc", vec![mov("pluggy-s", "2026-10-05", "2026-10", json!({ "categoria": "mercado" }))], "2026-09-01", None);
        let s = &simples["movimentacoes"][0];
        assert!(crate::lancamentos::CAMPOS_DO_USUARIO.iter().all(|c| s.get(*c).is_none()));
        assert_eq!(s["categoria"], "mercado", "pendente sem partes ganha nova chance, como antes");
    }

    #[test]
    fn valor_mudou_descarta_as_partes_e_mantem_o_resto() {
        let partes = json!([{ "valor": -6.0, "categoria": "p_comida" }, { "valor": -4.0, "categoria": "p_casa" }]);
        let vinculo = json!({ "tipo": "pessoa", "id": "e1", "pagamento_id": "lanc-pluggy-v" });
        let mut movs = json!({ "movimentacoes": [mov("pluggy-v", "2026-10-05", "2026-10", json!({
            "categoria": "p_comida", "classificacao": "manual", "natureza": "despesa", "partes": partes, "vinculo": vinculo, "quem": "Padaria"
        }))]});
        // Pendente que fechou com outro valor.
        let novo = mov("pluggy-v", "2026-10-05", "2026-10", json!({ "valor": -12.5, "categoria": "restaurantes", "natureza": "despesa" }));
        mesclar(&mut movs, "acc", vec![novo], "2026-09-01", None);
        let m = &movs["movimentacoes"][0];
        assert!(m.get("partes").is_none(), "partes não somam mais o valor");
        assert_eq!(m["valor"], -12.5);
        assert_eq!(m["categoria"], "p_comida", "a categoria principal fica");
        assert_eq!(m["vinculo"], vinculo, "o pagamento fica para você decidir");
        assert_eq!(m["quem"], "Padaria");
        // Mesmo valor (só arredondamento): as partes ficam.
        let mut movs = json!({ "movimentacoes": [mov("pluggy-w", "2026-10-05", "2026-10", json!({ "categoria": "p_comida", "partes": partes }))]});
        mesclar(&mut movs, "acc", vec![mov("pluggy-w", "2026-10-05", "2026-10", json!({ "valor": -10.000001 }))], "2026-09-01", None);
        assert_eq!(movs["movimentacoes"][0]["partes"], partes);
    }

    #[test]
    fn sincronizacao_que_remove_lancamento_ligado_desfaz_o_pagamento() {
        let vinculo = json!({ "tipo": "pessoa", "id": "e1", "pagamento_id": "lanc-pluggy-x" });
        let mut movs = json!({ "movimentacoes": [
            mov("pluggy-x", "2026-10-06", "2026-10", json!({ "vinculo": vinculo })),
            mov("pluggy-f", "2026-10-06", "2026-10", json!({ "vinculo": { "tipo": "fixa", "id": "f1" } })),
        ]});
        let antes = movs.clone();
        let ct = mesclar(&mut movs, "acc", vec![], "2026-09-01", None);
        assert_eq!(ct.removidas, 2);
        let sumidos = crate::lancamentos::pagamentos_sumidos(&antes, &movs);
        assert_eq!(sumidos, vec![("e1".to_string(), "lanc-pluggy-x".to_string())], "fixa fica como está");
        let mut emp = json!({ "emprestimos": [{ "id": "e1", "direcao": "eu_devo", "valor": 50.0, "data": "2026-10-01",
            "pagamentos": [{ "id": "lanc-pluggy-x", "data": "2026-10-06", "valor": 10.0 }, { "id": "pagamento-manual", "data": "2026-10-07", "valor": 5.0 }] }] });
        desfazer_pagamentos_sumidos(&mut emp, &sumidos, "agora");
        assert_eq!(emp["emprestimos"][0]["pagamentos"], json!([{ "id": "pagamento-manual", "data": "2026-10-07", "valor": 5.0 }]));
    }

    #[test]
    fn sincronizacao_que_remove_lancamento_ligado_a_divida_desfaz_o_pagamento() {
        let mut dividas = json!({ "dividas": [{ "id": "d1", "situacao": "ativa", "parcelas_restantes": 5, "proximo_vencimento": "2026-11-10",
            "saldos": [{ "data": "2026-10-01", "saldo_devedor": 1000.0, "status": "estimado", "origem": { "tipo": "informado" } }] }] });
        let original = dividas.clone();
        let mut x = mov("pluggy-x", "2026-10-06", "2026-10", json!({}));
        x["valor"] = json!(-100.0);
        let antes_divida = crate::dividas::pagar(&mut dividas, "d1", &x).unwrap();
        x["vinculo"] = json!({ "tipo": "divida", "id": "d1", "divida_antes": antes_divida });
        let mut movs = json!({ "movimentacoes": [x] });
        let antes = movs.clone();
        mesclar(&mut movs, "acc", vec![], "2026-09-01", None);
        let sumidos = crate::lancamentos::pagamentos_de_dividas_sumidos(&antes, &movs);
        assert_eq!(sumidos.len(), 1);
        desfazer_pagamentos_de_dividas_sumidos(&mut dividas, &sumidos);
        let mut esperado = original["dividas"][0].clone();
        esperado["pagamentos"] = json!([]);
        assert_eq!(dividas["dividas"][0], esperado);
        // Dívida que já não existe: ignorada.
        desfazer_pagamentos_de_dividas_sumidos(&mut json!({ "dividas": [] }), &sumidos);
    }

    #[test]
    fn saldo_no_fim_de_cada_mes() {
        let movs = json!({ "movimentacoes": [
            { "conta_id": "c", "data": "2026-09-10", "valor": -100.0, "origem": { "fonte": "pluggy" } },
            { "conta_id": "c", "data": "2026-10-05", "valor": 500.0, "origem": { "fonte": "pluggy" } },
            { "conta_id": "c", "data": "2026-11-02", "valor": -50.0, "origem": { "fonte": "pluggy" } },
            { "conta_id": "outra", "data": "2026-11-02", "valor": -999.0, "origem": { "fonte": "pluggy" } }
        ]});
        let hoje = NaiveDate::from_ymd_opt(2026, 11, 9).unwrap();
        let s = saldos_mensais(&movs, "c", 1000.0, hoje);
        assert_eq!(s, vec![("2026-09".into(), 550.0), ("2026-10".into(), 1050.0), ("2026-11".into(), 1000.0)]);
        // Saldo de extrato em arquivo não é sobrescrito.
        let mut m2 = movs.clone();
        m2["saldos"] = json!([{ "conta_id": "c", "competencia": "2026-10", "saldo_final": 7.0, "origem": { "documento_id": "x" } }]);
        gravar_saldos_mensais(&mut m2, "c", 1000.0, hoje);
        let l = m2["saldos"].as_array().unwrap();
        assert_eq!(l.len(), 3);
        assert_eq!(l.iter().find(|e| e["competencia"] == "2026-10").unwrap()["saldo_final"], 7.0);
    }

    #[test]
    fn saldo_mensal_ignora_lancamento_manual() {
        let movs = json!({ "movimentacoes": [
            { "conta_id": "c", "data": "2026-10-05", "valor": 500.0, "origem": { "fonte": "pluggy" } },
            { "conta_id": "c", "data": "2026-11-02", "valor": -50.0, "origem": { "fonte": "pluggy" } },
            // Lançado à mão na mesma conta: o saldo do banco já reflete (ou não) esse dinheiro.
            { "conta_id": "c", "data": "2026-11-03", "valor": -80.0, "origem": { "manual": true } }
        ]});
        let hoje = NaiveDate::from_ymd_opt(2026, 11, 9).unwrap();
        assert_eq!(saldos_mensais(&movs, "c", 1000.0, hoje), vec![("2026-10".into(), 1050.0), ("2026-11".into(), 1000.0)]);
    }

    #[test]
    fn divida_do_cartao_um_registro_por_mes() {
        let mut dv = json!({ "dividas": [{ "id": "cartao-x", "conta_id": "c", "tipo": "cartao_de_credito", "saldos": [
            { "data": "2026-09-30", "saldo_devedor": 3693.48, "origem": { "documento_id": "pdf" } }
        ]}]});
        let d1 = NaiveDate::from_ymd_opt(2026, 11, 8).unwrap();
        let d2 = NaiveDate::from_ymd_opt(2026, 11, 9).unwrap();
        atualizar_divida_cartao(&mut dv, "c", "Cartão", 4000.0, Some(2000.0), d1);
        atualizar_divida_cartao(&mut dv, "c", "Cartão", 4125.18, Some(2100.0), d2);
        let s = dv["dividas"][0]["saldos"].as_array().unwrap();
        assert_eq!(s.len(), 2);
        assert_eq!(s[1]["saldo_devedor"], 4125.18);
        // Cartão sem dívida cadastrada ganha uma.
        atualizar_divida_cartao(&mut dv, "novo", "Outro cartão", 10.0, None, d2);
        assert_eq!(dv["dividas"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn uuid() {
        assert!(parece_uuid("0a1b2c3d-0000-4000-8000-123456789abc"));
        assert!(!parece_uuid("https://0a1b2c3d-0000-4000-8000-123456789abc/"));
    }

    #[test]
    fn transferencia_entre_contas_suas() {
        let cfg = json!({ "contas": [
            { "id": "corrente-1", "tipo": "corrente" },
            { "id": "corrente-2", "tipo": "corrente", "papel": "reserva" },
            { "id": "cartao-1", "tipo": "cartao" }
        ]});
        let m = |id: &str, conta: &str, data: &str, valor: f64, natureza: &str, extra: Value| {
            let mut x = json!({ "id": id, "conta_id": conta, "data": data, "valor": valor, "natureza": natureza, "categoria": "transferencias", "classificacao": "media", "status": "confirmado" });
            for (k, v) in extra.as_object().unwrap() {
                x[k] = v.clone();
            }
            x
        };
        let mut movs = json!({ "movimentacoes": [
            m("a", "corrente-1", "2026-10-01", -500.0, "despesa", json!({})),
            m("b", "corrente-2", "2026-10-02", 500.0, "receita", json!({})),
            // Boleto pago pela reserva: continua despesa.
            m("c", "corrente-2", "2026-10-03", -120.0, "despesa", json!({})),
            // Entrada de terceiros na reserva: continua receita.
            m("d", "corrente-2", "2026-10-05", 300.0, "receita", json!({})),
            // Mesmo valor, mas 5 dias depois: não junta.
            m("e", "corrente-1", "2026-10-10", -300.0, "despesa", json!({})),
            // Escolha manual não muda.
            m("f", "corrente-1", "2026-10-03", -120.0, "despesa", json!({ "classificacao": "manual" }))
        ]});
        assert_eq!(casar_transferencias(&mut movs, &cfg), 1);
        let nat: Vec<&str> = movs["movimentacoes"].as_array().unwrap().iter().map(|x| x["natureza"].as_str().unwrap()).collect();
        assert_eq!(nat, ["transferencia_interna", "transferencia_interna", "despesa", "receita", "despesa", "despesa"]);
        assert_eq!(movs["movimentacoes"][0]["conciliado_com"]["id"], "b");
        assert_eq!(casar_transferencias(&mut movs, &cfg), 0, "rodar de novo não muda nada");
    }

    #[test]
    fn transferencia_nao_casa_com_lancamento_manual() {
        let cfg = json!({ "contas": [
            { "id": "corrente-1", "tipo": "corrente" },
            { "id": "corrente-2", "tipo": "corrente" }
        ]});
        let mut movs = json!({ "movimentacoes": [
            { "id": "a", "conta_id": "corrente-1", "data": "2026-10-01", "valor": -500.0, "natureza": "despesa", "classificacao": "media", "status": "confirmado" },
            { "id": "m", "conta_id": "corrente-2", "data": "2026-10-01", "valor": 500.0, "natureza": "receita", "classificacao": "baixa", "status": "confirmado", "origem": { "manual": true } }
        ]});
        assert_eq!(casar_transferencias(&mut movs, &cfg), 0);
        assert_eq!(movs["movimentacoes"][0]["natureza"], "despesa");
        assert_eq!(movs["movimentacoes"][1]["natureza"], "receita");
    }

    #[test]
    fn conta_do_mercado_pago_nasce_como_reserva() {
        let c = json!({ "id": "x", "type": "BANK", "number": "0001/12345-6", "name": "Conta" });
        assert_eq!(conta_nova_de(&c, "Mercado Pago")["papel"], "reserva");
        assert!(conta_nova_de(&c, "Santander")["papel"].is_null());
        let mp = json!({ "id": "y", "type": "BANK", "name": "Mercado Pago Instituição de Pagamento" });
        assert_eq!(instituicao_da_conta(&mp, "MeuPluggy"), "Mercado Pago");
        assert_eq!(instituicao_da_conta(&json!({ "name": "Banco Santander Pessoa Física" }), "MeuPluggy"), "Santander");
        assert_eq!(instituicao_da_conta(&mp, "Banco Exemplo"), "Banco Exemplo");
    }
}