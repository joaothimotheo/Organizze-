//! Metas de economia (`metas.json` → `metas[]`): criar, editar, excluir e guardar dinheiro.

use crate::emprestimos::Falha;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub struct NovaMeta {
    pub nome: String,
    pub valor_alvo: f64,
    /// Quanto já está guardado.
    #[serde(default)]
    pub saldo_reservado: f64,
    pub prazo: Option<String>,
    pub aporte_mensal_planejado: Option<f64>,
    /// O progresso acompanha o saldo das contas marcadas como reserva.
    #[serde(default)]
    pub usar_reserva: bool,
}

fn r2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn validar(m: &NovaMeta) -> Result<(), Falha> {
    let nome = m.nome.trim();
    if nome.is_empty() || nome.chars().count() > 80 {
        return Err(Falha::Invalido("dê um nome para a meta (até 80 letras)".into()));
    }
    if !m.valor_alvo.is_finite() || m.valor_alvo < 0.01 {
        return Err(Falha::Invalido("o valor da meta deve ser maior que zero".into()));
    }
    if !m.saldo_reservado.is_finite() || m.saldo_reservado < 0.0 {
        return Err(Falha::Invalido("o valor guardado não pode ser negativo".into()));
    }
    if m.aporte_mensal_planejado.is_some_and(|a| !a.is_finite() || a < 0.0) {
        return Err(Falha::Invalido("o valor por mês não pode ser negativo".into()));
    }
    if let Some(p) = m.prazo.as_deref().filter(|p| !p.is_empty()) {
        if chrono::NaiveDate::parse_from_str(p, "%Y-%m-%d").is_err() {
            return Err(Falha::Invalido("prazo inválido".into()));
        }
    }
    Ok(())
}

fn lista(arq: &mut Value) -> &mut Vec<Value> {
    if !arq.is_object() {
        *arq = json!({ "schema_version": 1 });
    }
    if !arq["metas"].is_array() {
        arq["metas"] = json!([]);
    }
    arq["metas"].as_array_mut().unwrap()
}

fn aplicar(alvo: &mut Value, m: &NovaMeta) {
    alvo["nome"] = json!(m.nome.trim());
    alvo["valor_alvo"] = json!(r2(m.valor_alvo));
    alvo["saldo_reservado"] = json!(r2(m.saldo_reservado));
    alvo["prazo"] = json!(m.prazo.as_deref().filter(|p| !p.is_empty()));
    alvo["aporte_mensal_planejado"] = json!(m.aporte_mensal_planejado.map(r2));
    alvo["usar_reserva"] = json!(m.usar_reserva);
}

pub fn criar(arq: &mut Value, m: &NovaMeta, id: String, agora: &str) -> Result<Value, Falha> {
    validar(m)?;
    let mut nova = json!({ "id": id, "criada_em": agora });
    aplicar(&mut nova, m);
    lista(arq).push(nova.clone());
    arq["atualizado_em"] = json!(agora);
    Ok(nova)
}

pub fn editar(arq: &mut Value, id: &str, m: &NovaMeta, agora: &str) -> Result<Value, Falha> {
    validar(m)?;
    let alvo = lista(arq).iter_mut().find(|x| x["id"].as_str() == Some(id)).ok_or(Falha::NaoEncontrado("meta não encontrada"))?;
    aplicar(alvo, m);
    let r = alvo.clone();
    arq["atualizado_em"] = json!(agora);
    Ok(r)
}

pub fn excluir(arq: &mut Value, id: &str, agora: &str) -> Result<(), Falha> {
    let l = lista(arq);
    let antes = l.len();
    l.retain(|x| x["id"].as_str() != Some(id));
    if l.len() == antes {
        return Err(Falha::NaoEncontrado("meta não encontrada"));
    }
    arq["atualizado_em"] = json!(agora);
    Ok(())
}

/// Soma (ou, com valor negativo, tira) do que está guardado na meta.
pub fn guardar(arq: &mut Value, id: &str, valor: f64, agora: &str) -> Result<Value, Falha> {
    if !valor.is_finite() || valor.abs() < 0.01 {
        return Err(Falha::Invalido("informe um valor".into()));
    }
    let alvo = lista(arq).iter_mut().find(|x| x["id"].as_str() == Some(id)).ok_or(Falha::NaoEncontrado("meta não encontrada"))?;
    let atual = alvo["saldo_reservado"].as_f64().unwrap_or(0.0);
    let novo = r2(atual + valor);
    if novo < 0.0 {
        return Err(Falha::Invalido("não dá para tirar mais do que está guardado".into()));
    }
    alvo["saldo_reservado"] = json!(novo);
    let r = alvo.clone();
    arq["atualizado_em"] = json!(agora);
    Ok(r)
}

#[cfg(test)]
mod testes {
    use super::*;

    fn meta(nome: &str, alvo: f64) -> NovaMeta {
        NovaMeta { nome: nome.into(), valor_alvo: alvo, saldo_reservado: 0.0, prazo: None, aporte_mensal_planejado: None, usar_reserva: true }
    }

    #[test]
    fn cria_guarda_edita_e_exclui() {
        let mut arq = json!({});
        let m = criar(&mut arq, &meta("Reserva de emergência", 5000.0), "meta-1".into(), "agora").unwrap();
        assert_eq!((m["valor_alvo"].as_f64(), m["usar_reserva"].as_bool()), (Some(5000.0), Some(true)));
        assert!(criar(&mut arq, &meta("", 10.0), "x".into(), "agora").is_err());
        assert!(criar(&mut arq, &meta("Zero", 0.0), "x".into(), "agora").is_err());
        assert_eq!(guardar(&mut arq, "meta-1", 250.5, "agora").unwrap()["saldo_reservado"], 250.5);
        assert!(guardar(&mut arq, "meta-1", -300.0, "agora").is_err());
        assert_eq!(guardar(&mut arq, "meta-1", -50.5, "agora").unwrap()["saldo_reservado"], 200.0);
        let mut e = meta("Reserva", 6000.0);
        e.saldo_reservado = 200.0;
        assert_eq!(editar(&mut arq, "meta-1", &e, "agora").unwrap()["valor_alvo"], 6000.0);
        excluir(&mut arq, "meta-1", "agora").unwrap();
        assert_eq!(excluir(&mut arq, "meta-1", "agora"), Err(Falha::NaoEncontrado("meta não encontrada")));
    }
}
