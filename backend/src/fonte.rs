//! "Modelo antigo" (só documentos): tira dos dados o que veio da sincronização com o banco
//! (Pluggy), deixando só o que foi lido de holerites, faturas em PDF e extratos OFX/CSV.
//! Nada é apagado: o filtro vale só para a resposta.

use serde_json::Value;

fn do_banco(v: &Value) -> bool {
    v["origem"]["fonte"].as_str() == Some("pluggy")
}

fn tirar(v: &mut Value, chave: &str) {
    if let Some(l) = v.get_mut(chave).and_then(Value::as_array_mut) {
        l.retain(|x| !do_banco(x));
    }
}

/// Filtra o arquivo `nome` (já lido) para o modelo só com documentos.
pub fn so_documentos(nome: &str, v: &mut Value) {
    match nome {
        "movimentacoes" => {
            tirar(v, "movimentacoes");
            tirar(v, "saldos");
        }
        "dividas" => {
            if let Some(l) = v.get_mut("dividas").and_then(Value::as_array_mut) {
                for d in l.iter_mut() {
                    tirar(d, "saldos");
                }
                // A dívida do cartão criada pela sincronização some se ficou sem nenhum saldo.
                l.retain(|d| !(d["id"].as_str().is_some_and(|i| i.starts_with("divida-")) && d["saldos"].as_array().is_some_and(Vec::is_empty)));
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use serde_json::json;

    #[test]
    fn tira_so_o_que_veio_do_banco() {
        let mut movs = json!({
            "movimentacoes": [
                { "id": "pdf-1", "origem": { "documento_id": "doc" } },
                { "id": "pluggy-1", "origem": { "fonte": "pluggy" } },
                { "id": "manual" }
            ],
            "saldos": [{ "conta_id": "c", "origem": { "fonte": "pluggy" } }, { "conta_id": "c" }]
        });
        so_documentos("movimentacoes", &mut movs);
        let ids: Vec<&str> = movs["movimentacoes"].as_array().unwrap().iter().map(|m| m["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["pdf-1", "manual"]);
        assert_eq!(movs["saldos"].as_array().unwrap().len(), 1);

        let mut dividas = json!({ "dividas": [
            { "id": "divida-cartao", "saldos": [{ "saldo_devedor": 10.0, "origem": { "fonte": "pluggy" } }] },
            { "id": "divida-cartao-pdf", "saldos": [{ "saldo_devedor": 5.0 }, { "saldo_devedor": 9.0, "origem": { "fonte": "pluggy" } }] },
            { "id": "emprestimo-x", "saldos": [] }
        ]});
        so_documentos("dividas", &mut dividas);
        let l = dividas["dividas"].as_array().unwrap();
        assert_eq!(l.len(), 2, "a do cartão só com saldo do banco sai; a informada à mão fica");
        assert_eq!(l[0]["saldos"].as_array().unwrap().len(), 1);
    }
}
