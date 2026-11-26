//! Limites de gasto por categoria (`orcamentos.json` → `limites[]`): quanto você quer gastar no
//! máximo em cada grupo por mês. Um item por categoria: `{ categoria, limite, atualizado_em }`.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::emprestimos::Falha;

fn r2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

pub fn lista(arq: &Value) -> Vec<Value> {
    arq["limites"].as_array().cloned().unwrap_or_default()
}

/// Define (ou, com `limite` nulo ou zero, tira) o limite mensal de uma categoria.
pub fn definir(arq: &mut Value, categoria: &str, limite: Option<f64>, agora: &str) -> Result<Value, Falha> {
    let categoria = categoria.trim();
    if categoria.is_empty() || categoria.chars().count() > 80 {
        return Err(Falha::Invalido("categoria inválida".into()));
    }
    let limite = limite.filter(|v| *v != 0.0);
    if let Some(v) = limite {
        if !v.is_finite() || v < 0.0 || v > 10_000_000.0 {
            return Err(Falha::Invalido("o limite precisa ser um valor positivo em reais".into()));
        }
    }
    if !arq.is_object() {
        *arq = json!({ "schema_version": 1 });
    }
    let mut l = lista(arq);
    l.retain(|x| x["categoria"].as_str() != Some(categoria));
    let novo = limite.map(|v| json!({ "categoria": categoria, "limite": r2(v), "atualizado_em": agora }));
    if let Some(n) = &novo {
        l.push(n.clone());
    }
    l.sort_by(|a, b| a["categoria"].as_str().cmp(&b["categoria"].as_str()));
    arq["limites"] = json!(l);
    arq["atualizado_em"] = json!(agora);
    Ok(novo.unwrap_or(json!({ "categoria": categoria, "limite": null })))
}

/// Gasto por categoria (positivo) nas despesas da competência `mes`; dividido em partes, cada
/// parte no seu grupo (partes que não somam o valor contam a categoria inteira).
pub fn gasto_por_categoria(movs: &[Value], mes: &str) -> HashMap<String, f64> {
    let mut t: HashMap<String, f64> = HashMap::new();
    for m in movs {
        if m["natureza"].as_str() != Some("despesa") || crate::fixas::competencia(m) != mes {
            continue;
        }
        let valor = m["valor"].as_f64().unwrap_or(0.0);
        let partes = m["partes"].as_array().filter(|p| !p.is_empty());
        let fecham = partes.is_some_and(|p| ((p.iter().map(|x| x["valor"].as_f64().unwrap_or(0.0)).sum::<f64>() - valor) * 100.0).round() == 0.0);
        match partes.filter(|_| fecham) {
            Some(p) => {
                for x in p {
                    let c = x["categoria"].as_str().filter(|c| !c.is_empty()).unwrap_or("a_classificar");
                    *t.entry(c.to_string()).or_default() -= x["valor"].as_f64().unwrap_or(0.0);
                }
            }
            None => {
                let c = m["categoria"].as_str().filter(|c| !c.is_empty()).unwrap_or("a_classificar");
                *t.entry(c.to_string()).or_default() -= valor;
            }
        }
    }
    t.into_iter().map(|(k, v)| (k, r2(v))).collect()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn define_troca_e_tira_limite() {
        let mut a = Value::Null;
        definir(&mut a, "mercado", Some(600.0), "t1").unwrap();
        definir(&mut a, "lazer", Some(200.456), "t1").unwrap();
        definir(&mut a, "mercado", Some(650.0), "t2").unwrap();
        assert_eq!(lista(&a), vec![json!({ "categoria": "lazer", "limite": 200.46, "atualizado_em": "t1" }), json!({ "categoria": "mercado", "limite": 650.0, "atualizado_em": "t2" })]);
        let r = definir(&mut a, "lazer", None, "t3").unwrap();
        assert_eq!(r, json!({ "categoria": "lazer", "limite": null }));
        definir(&mut a, "mercado", Some(0.0), "t3").unwrap();
        assert!(lista(&a).is_empty());
    }

    #[test]
    fn recusa_limite_invalido() {
        let mut a = Value::Null;
        assert!(definir(&mut a, "mercado", Some(-1.0), "t").is_err());
        assert!(definir(&mut a, "mercado", Some(f64::NAN), "t").is_err());
        assert!(definir(&mut a, " ", Some(10.0), "t").is_err());
    }

    #[test]
    fn gasto_do_mes_por_categoria_com_partes() {
        let movs = vec![
            json!({ "data": "2026-11-02", "valor": -100.0, "natureza": "despesa", "categoria": "mercado" }),
            json!({ "data": "2026-11-03", "valor": -50.0, "natureza": "despesa", "categoria": "mercado", "partes": [{ "valor": -30.0, "categoria": "mercado" }, { "valor": -20.0, "categoria": "lazer" }] }),
            // Partes que não fecham: a categoria inteira.
            json!({ "data": "2026-11-04", "valor": -10.0, "natureza": "despesa", "categoria": "lazer", "partes": [{ "valor": -3.0, "categoria": "mercado" }] }),
            // Competência do cartão: outubro, fora.
            json!({ "data": "2026-11-05", "competencia": "2026-10", "valor": -999.0, "natureza": "despesa", "categoria": "mercado" }),
            json!({ "data": "2026-11-06", "valor": 40.0, "natureza": "estorno", "categoria": "mercado" }),
            json!({ "data": "2026-11-07", "valor": -7.0, "natureza": "despesa" }),
        ];
        let g = gasto_por_categoria(&movs, "2026-11");
        assert_eq!(g["mercado"], 130.0);
        assert_eq!(g["lazer"], 30.0);
        assert_eq!(g["a_classificar"], 7.0);
        assert_eq!(g.len(), 3);
    }
}
