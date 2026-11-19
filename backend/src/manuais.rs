//! Lançamentos manuais (`movimentacoes.json` → `movimentacoes[]`): gastos e entradas
//! que não vieram do banco, como dinheiro vivo ou um Pix esquecido.

use crate::emprestimos::Falha;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub struct NovoLancamento {
    /// "gasto" ou "entrada".
    pub tipo: String,
    pub valor: f64,
    pub descricao: String,
    /// Data no formato AAAA-MM-DD.
    pub data: String,
    /// Conta do lançamento; vazio = dinheiro.
    pub conta_id: Option<String>,
}

/// Arredonda para centavos, meio para longe do zero. O pequeno acréscimo cobre valores
/// como 10.005, que em ponto flutuante é na verdade 10.00499999...
/// Maior valor aceito num lançamento manual, em reais.
pub const VALOR_MAXIMO: f64 = 1_000_000.0;

fn centavos(v: f64) -> f64 {
    ((v.abs() * 100.0) + 1e-7).round() / 100.0
}

fn data_valida(s: &str) -> bool {
    s.len() == 10 && chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

/// Valida e acrescenta o lançamento em `movimentacoes[]`; devolve o que foi gravado.
pub fn criar(movs: &mut Value, n: &NovoLancamento, id: String, _agora: &str) -> Result<Value, Falha> {
    let descricao = n.descricao.trim();
    if descricao.is_empty() || descricao.chars().count() > 120 {
        return Err(Falha::Invalido("a descrição deve ter de 1 a 120 letras".into()));
    }
    if !data_valida(&n.data) {
        return Err(Falha::Invalido("data inválida: use o formato AAAA-MM-DD".into()));
    }
    let gasto = match n.tipo.as_str() {
        "gasto" => true,
        "entrada" => false,
        _ => return Err(Falha::Invalido("o tipo deve ser \"gasto\" ou \"entrada\"".into())),
    };
    if !n.valor.is_finite() || n.valor <= 0.0 || centavos(n.valor) < 0.01 {
        return Err(Falha::Invalido("o valor deve ser maior que zero".into()));
    }
    let valor = centavos(n.valor);
    if !valor.is_finite() || valor > VALOR_MAXIMO {
        return Err(Falha::Invalido("o valor pode ser até R$ 1.000.000,00".into()));
    }
    let conta = n.conta_id.as_deref().map(str::trim).filter(|c| !c.is_empty()).unwrap_or("dinheiro");
    let lancamento = json!({
        "id": id,
        "data": n.data,
        "descricao": descricao,
        "valor": if gasto { -valor } else { valor },
        "natureza": if gasto { "despesa" } else { "receita" },
        "categoria": "a_classificar",
        "classificacao": "baixa",
        "status": "confirmado",
        "competencia": &n.data[..7],
        "conta_id": conta,
        "origem": { "manual": true },
    });
    if !movs.is_object() {
        *movs = json!({ "schema_version": 1 });
    }
    if !movs["movimentacoes"].is_array() {
        movs["movimentacoes"] = json!([]);
    }
    movs["movimentacoes"].as_array_mut().unwrap().push(lancamento.clone());
    Ok(lancamento)
}

/// Apaga um lançamento feito à mão. Os que vieram do banco não podem ser apagados aqui.
pub fn apagar(movs: &mut Value, id: &str) -> Result<(), Falha> {
    let Some(lista) = movs.get_mut("movimentacoes").and_then(Value::as_array_mut) else {
        return Err(Falha::NaoEncontrado("lançamento não encontrado"));
    };
    let Some(i) = lista.iter().position(|m| m["id"].as_str() == Some(id)) else {
        return Err(Falha::NaoEncontrado("lançamento não encontrado"));
    };
    if lista[i]["origem"]["manual"].as_bool() != Some(true) {
        return Err(Falha::Invalido("só lançamentos feitos à mão podem ser apagados".into()));
    }
    lista.remove(i);
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;

    fn novo(tipo: &str, valor: f64, descricao: &str, data: &str) -> NovoLancamento {
        NovoLancamento { tipo: tipo.into(), valor, descricao: descricao.into(), data: data.into(), conta_id: None }
    }

    #[test]
    fn gasto_vira_despesa_negativa() {
        let mut movs = json!({ "movimentacoes": [] });
        let r = criar(&mut movs, &novo("gasto", 45.9, "  Padaria ", "2026-11-19"), "manual-1".into(), "2026-11-19T10:00:00-03:00").unwrap();
        assert_eq!(r["valor"], json!(-45.9));
        assert_eq!(r["natureza"], "despesa");
        assert_eq!(r["competencia"], "2026-11");
        assert_eq!(r["categoria"], "a_classificar");
        assert_eq!(r["classificacao"], "baixa");
        assert_eq!(r["status"], "confirmado");
        assert_eq!(r["conta_id"], "dinheiro");
        assert_eq!(r["descricao"], "Padaria");
        assert_eq!(r["origem"]["manual"], true);
        assert_eq!(r["id"], "manual-1");
        assert_eq!(movs["movimentacoes"].as_array().unwrap().len(), 1);
        assert_eq!(movs["movimentacoes"][0], r);
    }

    #[test]
    fn entrada_vira_receita_positiva() {
        let mut movs = json!({ "movimentacoes": [] });
        let mut n = novo("entrada", 200.0, "Venda", "2026-11-19");
        n.conta_id = Some("conta-1".into());
        let r = criar(&mut movs, &n, "manual-2".into(), "agora").unwrap();
        assert_eq!(r["valor"], json!(200.0));
        assert_eq!(r["natureza"], "receita");
        assert_eq!(r["conta_id"], "conta-1");
    }

    #[test]
    fn recusa_invalidos() {
        let longa = "a".repeat(121);
        let casos = [
            novo("gasto", 0.0, "x", "2026-11-19"),
            novo("gasto", -3.0, "x", "2026-11-19"),
            novo("gasto", 0.004, "x", "2026-11-19"),
            novo("gasto", f64::NAN, "x", "2026-11-19"),
            novo("gasto", 5.0, "  ", "2026-11-19"),
            novo("gasto", 5.0, &longa, "2026-11-19"),
            novo("gasto", 5.0, "x", "19/11/2026"),
            novo("gasto", 5.0, "x", "2026-02-30"),
            novo("outro", 5.0, "x", "2026-11-19"),
        ];
        for c in &casos {
            let mut movs = json!({ "movimentacoes": [] });
            assert!(matches!(criar(&mut movs, c, "i".into(), "a"), Err(Falha::Invalido(_))), "{c:?}");
            assert_eq!(movs["movimentacoes"].as_array().unwrap().len(), 0);
        }
    }

    #[test]
    fn arredonda_centavos() {
        let mut movs = json!({ "movimentacoes": [] });
        let r = criar(&mut movs, &novo("gasto", 10.005, "x", "2026-11-19"), "i".into(), "a").unwrap();
        assert_eq!(r["valor"], json!(-10.01));
    }

    #[test]
    fn teto_de_um_milhao() {
        let mut movs = json!({ "movimentacoes": [] });
        let r = criar(&mut movs, &novo("gasto", 1_000_000.0, "x", "2026-11-19"), "i".into(), "a").unwrap();
        assert_eq!(r["valor"], json!(-1_000_000.0));
        for v in [1_000_000.01, 1e300, f64::INFINITY, f64::MAX] {
            let mut movs = json!({ "movimentacoes": [] });
            match criar(&mut movs, &novo("gasto", v, "x", "2026-11-19"), "i".into(), "a") {
                Err(Falha::Invalido(m)) => assert!(m.contains("1.000.000,00") || m.contains("maior que zero"), "{v}: {m}"),
                outro => panic!("{v}: {outro:?}"),
            }
            assert_eq!(movs["movimentacoes"].as_array().unwrap().len(), 0);
        }
        let mut movs = json!({ "movimentacoes": [] });
        match criar(&mut movs, &novo("gasto", 1_000_000.01, "x", "2026-11-19"), "i".into(), "a") {
            Err(Falha::Invalido(m)) => assert_eq!(m, "o valor pode ser até R$ 1.000.000,00"),
            outro => panic!("{outro:?}"),
        }
    }

    fn arquivo_misto() -> Value {
        json!({ "movimentacoes": [
            { "id": "manual-1", "valor": -10.0, "origem": { "manual": true } },
            { "id": "banco-1", "valor": -20.0, "origem": { "pluggy": "x" } },
            { "id": "sem-origem", "valor": -5.0 },
        ] })
    }

    #[test]
    fn apaga_lancamento_manual() {
        let mut movs = arquivo_misto();
        apagar(&mut movs, "manual-1").unwrap();
        let ids: Vec<&str> = movs["movimentacoes"].as_array().unwrap().iter().map(|m| m["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["banco-1", "sem-origem"]);
    }

    #[test]
    fn recusa_apagar_do_banco() {
        for id in ["banco-1", "sem-origem"] {
            let mut movs = arquivo_misto();
            match apagar(&mut movs, id) {
                Err(Falha::Invalido(m)) => assert_eq!(m, "só lançamentos feitos à mão podem ser apagados"),
                outro => panic!("{id}: {outro:?}"),
            }
            assert_eq!(movs["movimentacoes"].as_array().unwrap().len(), 3);
        }
    }

    #[test]
    fn apagar_inexistente_da_404() {
        let mut movs = arquivo_misto();
        assert!(matches!(apagar(&mut movs, "nada"), Err(Falha::NaoEncontrado(_))));
        let mut vazio = json!({});
        assert!(matches!(apagar(&mut vazio, "nada"), Err(Falha::NaoEncontrado(_))));
    }

    #[test]
    fn arquivo_sem_lista() {
        let mut movs = json!({});
        criar(&mut movs, &novo("gasto", 1.0, "x", "2026-11-19"), "i".into(), "a").unwrap();
        assert_eq!(movs["movimentacoes"].as_array().unwrap().len(), 1);
    }
}
