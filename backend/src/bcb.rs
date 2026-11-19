//! Consulta às séries do Banco Central (SGS) e gravação em indicadores.json.
//! Roda só quando alguém pede (POST /api/indicadores/atualizar). Não há agendamento.

use anyhow::{anyhow, Context, Result};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// (chave em indicadores.json, código SGS, unidade)
pub const SERIES: [(&str, u32, &str); 4] = [
    ("selic_meta_aa", 432, "% a.a."),
    ("selic_dia", 11, "% a.d."),
    ("cdi_dia", 12, "% a.d."),
    ("cdi_aa", 4389, "% a.a. (base 252)"),
];

#[derive(Deserialize)]
struct RegistroSgs {
    data: String,
    valor: String,
}

#[derive(Debug, Serialize)]
pub struct ResultadoSerie {
    pub serie: String,
    pub sgs: u32,
    pub ok: bool,
    pub ultimo: Option<Value>,
    pub erro: Option<String>,
}

fn converter(r: RegistroSgs) -> Result<Value> {
    let d = NaiveDate::parse_from_str(&r.data, "%d/%m/%Y").with_context(|| format!("data inválida {}", r.data))?;
    let v: f64 = r.valor.trim().parse().with_context(|| format!("valor inválido {}", r.valor))?;
    Ok(json!({ "data": d.format("%Y-%m-%d").to_string(), "valor": v }))
}

pub async fn buscar(cliente: &reqwest::Client, sgs: u32, ultimos: u32) -> Result<Vec<Value>> {
    let url = format!("https://api.bcb.gov.br/dados/serie/bcdata.sgs.{sgs}/dados/ultimos/{ultimos}?formato=json");
    let resp = cliente.get(&url).send().await.with_context(|| format!("sem conexão com {url}"))?;
    if !resp.status().is_success() {
        return Err(anyhow!("BCB respondeu {} para a série {sgs}", resp.status()));
    }
    let regs: Vec<RegistroSgs> = resp.json().await.context("resposta do BCB fora do formato esperado")?;
    regs.into_iter().map(converter).collect()
}

/// Junta registros novos aos existentes, sem duplicar datas, em ordem crescente.
pub fn mesclar(existentes: &[Value], novos: &[Value]) -> Vec<Value> {
    let mut m = std::collections::BTreeMap::new();
    for r in existentes.iter().chain(novos) {
        if let Some(d) = r.get("data").and_then(|x| x.as_str()) {
            m.insert(d.to_string(), r.clone());
        }
    }
    m.into_values().collect()
}

/// Atualiza o documento de indicadores em memória e devolve o resultado de cada série.
pub async fn atualizar(cliente: &reqwest::Client, doc: &mut Value, agora: &str) -> Vec<ResultadoSerie> {
    if !doc.is_object() {
        *doc = json!({ "schema_version": 1 });
    }
    if !doc.get("series").map(|s| s.is_object()).unwrap_or(false) {
        doc["series"] = json!({});
    }
    let mut res = vec![];
    let mut alguma_ok = false;
    for (chave, sgs, unidade) in SERIES {
        match buscar(cliente, sgs, 20).await {
            Ok(novos) => {
                let s = &mut doc["series"][chave];
                if !s.is_object() {
                    *s = json!({});
                }
                let existentes = s.get("registros").and_then(|r| r.as_array()).cloned().unwrap_or_default();
                let todos = mesclar(&existentes, &novos);
                s["sgs"] = json!(sgs);
                s["unidade"] = json!(unidade);
                s["fonte"] = json!(format!("BCB/SGS {sgs}"));
                s["registros"] = Value::Array(todos.clone());
                alguma_ok = true;
                res.push(ResultadoSerie { serie: chave.into(), sgs, ok: true, ultimo: todos.last().cloned(), erro: None });
            }
            Err(e) => res.push(ResultadoSerie { serie: chave.into(), sgs, ok: false, ultimo: None, erro: Some(format!("{e:#}")) }),
        }
    }
    if alguma_ok {
        doc["atualizado_em"] = json!(agora);
        doc["metodo"] = json!("Consulta à API SGS do Banco Central feita pelo back-end, a pedido do usuário.");
    }
    res
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn converte_data_e_valor_do_sgs() {
        let v = converter(RegistroSgs { data: "09/10/2026".into(), valor: "13.65".into() }).unwrap();
        assert_eq!(v, json!({"data": "2026-10-09", "valor": 13.65}));
    }

    #[test]
    fn mescla_sem_duplicar_datas() {
        let a = vec![json!({"data":"2026-10-08","valor":1.0}), json!({"data":"2026-10-09","valor":1.0})];
        let b = vec![json!({"data":"2026-10-09","valor":2.0}), json!({"data":"2026-10-10","valor":3.0})];
        let m = mesclar(&a, &b);
        assert_eq!(m.len(), 3);
        assert_eq!(m[1]["valor"], 2.0);
    }
}
