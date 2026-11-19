//! Contas fixas (`fixas.json` → `fixas[]`): assinaturas e contas que se repetem todo mês,
//! inclusive as pagas por fora do banco sincronizado (Pix, dinheiro, boleto).

use crate::emprestimos::Falha;
use serde::Deserialize;
use serde_json::{json, Value};

const FORMAS: [&str; 6] = ["pix", "cartao", "debito", "boleto", "dinheiro", "outro"];

#[derive(Debug, Deserialize)]
pub struct NovaFixa {
    pub nome: String,
    pub valor: f64,
    /// Dia do mês em que vence ou é cobrada (1 a 31).
    pub dia: Option<u32>,
    pub forma: String,
    pub categoria: Option<String>,
    /// Trecho da descrição no banco que identifica o pagamento ("NETFLIX"). Vazio = só marcação manual.
    pub busca: Option<String>,
    #[serde(default = "sim")]
    pub ativa: bool,
}

fn sim() -> bool {
    true
}

fn r2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn validar(f: &NovaFixa) -> Result<(), Falha> {
    let nome = f.nome.trim();
    if nome.is_empty() || nome.chars().count() > 80 {
        return Err(Falha::Invalido("dê um nome para a conta (até 80 letras)".into()));
    }
    if !f.valor.is_finite() || f.valor < 0.01 {
        return Err(Falha::Invalido("o valor deve ser maior que zero".into()));
    }
    if f.dia.is_some_and(|d| !(1..=31).contains(&d)) {
        return Err(Falha::Invalido("o dia deve estar entre 1 e 31".into()));
    }
    if !FORMAS.contains(&f.forma.as_str()) {
        return Err(Falha::Invalido("forma de pagamento desconhecida".into()));
    }
    if f.busca.as_deref().is_some_and(|b| b.trim().chars().count() > 60) {
        return Err(Falha::Invalido("o texto para achar no banco pode ter até 60 letras".into()));
    }
    Ok(())
}

fn lista(arq: &mut Value) -> &mut Vec<Value> {
    if !arq.is_object() {
        *arq = json!({ "schema_version": 1 });
    }
    if !arq["fixas"].is_array() {
        arq["fixas"] = json!([]);
    }
    arq["fixas"].as_array_mut().unwrap()
}

fn aplicar(alvo: &mut Value, f: &NovaFixa, agora: &str) {
    let texto = |v: &Option<String>| v.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    alvo["nome"] = json!(f.nome.trim());
    alvo["valor"] = json!(r2(f.valor));
    alvo["dia"] = json!(f.dia);
    alvo["forma"] = json!(f.forma);
    alvo["categoria"] = json!(texto(&f.categoria));
    alvo["busca"] = json!(texto(&f.busca));
    // Ao cancelar, guarda quando foi; ao reativar, apaga.
    if f.ativa {
        alvo["cancelada_em"] = Value::Null;
    } else if alvo["cancelada_em"].as_str().is_none() || alvo["ativa"] != json!(false) {
        alvo["cancelada_em"] = json!(agora.get(..10).unwrap_or(agora));
    }
    alvo["ativa"] = json!(f.ativa);
    if !alvo["pagos"].is_array() {
        alvo["pagos"] = json!([]);
    }
}

pub fn criar(arq: &mut Value, f: &NovaFixa, id: String, agora: &str) -> Result<Value, Falha> {
    validar(f)?;
    let mut nova = json!({ "id": id, "criada_em": agora });
    aplicar(&mut nova, f, agora);
    lista(arq).push(nova.clone());
    arq["atualizado_em"] = json!(agora);
    Ok(nova)
}

pub fn editar(arq: &mut Value, id: &str, f: &NovaFixa, agora: &str) -> Result<Value, Falha> {
    validar(f)?;
    let alvo = lista(arq).iter_mut().find(|x| x["id"].as_str() == Some(id)).ok_or(Falha::NaoEncontrado("conta fixa não encontrada"))?;
    aplicar(alvo, f, agora);
    let r = alvo.clone();
    arq["atualizado_em"] = json!(agora);
    Ok(r)
}

pub fn excluir(arq: &mut Value, id: &str, agora: &str) -> Result<(), Falha> {
    let l = lista(arq);
    let antes = l.len();
    l.retain(|x| x["id"].as_str() != Some(id));
    if l.len() == antes {
        return Err(Falha::NaoEncontrado("conta fixa não encontrada"));
    }
    arq["atualizado_em"] = json!(agora);
    Ok(())
}

/// Marca (ou desmarca) a conta como paga no mês ("2026-11"), para as que não aparecem no banco.
pub fn marcar_pago(arq: &mut Value, id: &str, mes: &str, pago: bool, agora: &str) -> Result<Value, Falha> {
    if chrono::NaiveDate::parse_from_str(&format!("{mes}-01"), "%Y-%m-%d").is_err() || mes.len() != 7 {
        return Err(Falha::Invalido("mês inválido".into()));
    }
    let alvo = lista(arq).iter_mut().find(|x| x["id"].as_str() == Some(id)).ok_or(Falha::NaoEncontrado("conta fixa não encontrada"))?;
    let mut pagos: Vec<String> = alvo["pagos"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    pagos.retain(|m| m != mes);
    if pago {
        pagos.push(mes.to_string());
    }
    pagos.sort();
    alvo["pagos"] = json!(pagos);
    let r = alvo.clone();
    arq["atualizado_em"] = json!(agora);
    Ok(r)
}

/// Sugestão do banco que você mandou não mostrar mais (assinatura já cancelada), pela chave do lugar.
pub fn ignorar(arq: &mut Value, chave: &str, ignorar: bool, agora: &str) -> Result<Vec<String>, Falha> {
    let chave = chave.trim();
    if chave.is_empty() || chave.chars().count() > 120 {
        return Err(Falha::Invalido("sugestão inválida".into()));
    }
    lista(arq);
    let mut l: Vec<String> = arq["ignoradas"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    l.retain(|c| c != chave);
    if ignorar {
        l.push(chave.to_string());
    }
    l.sort();
    arq["ignoradas"] = json!(l);
    arq["atualizado_em"] = json!(agora);
    Ok(l)
}

#[cfg(test)]
mod testes {
    use super::*;

    fn fixa(nome: &str, valor: f64, forma: &str) -> NovaFixa {
        NovaFixa { nome: nome.into(), valor, dia: Some(10), forma: forma.into(), categoria: None, busca: Some("  ".into()), ativa: true }
    }

    #[test]
    fn cria_marca_edita_e_exclui() {
        let mut arq = json!({});
        let f = criar(&mut arq, &fixa("TV a cabo", 129.9, "pix"), "fixa-1".into(), "agora").unwrap();
        assert_eq!((f["valor"].as_f64(), f["busca"].is_null(), f["pagos"].as_array().map(Vec::len)), (Some(129.9), true, Some(0)));
        assert!(criar(&mut arq, &fixa("", 10.0, "pix"), "x".into(), "agora").is_err());
        assert!(criar(&mut arq, &fixa("Zero", 0.0, "pix"), "x".into(), "agora").is_err());
        assert!(criar(&mut arq, &fixa("Forma", 10.0, "cheque"), "x".into(), "agora").is_err());
        let mut d = fixa("Dia", 10.0, "pix");
        d.dia = Some(32);
        assert!(criar(&mut arq, &d, "x".into(), "agora").is_err());

        assert_eq!(marcar_pago(&mut arq, "fixa-1", "2026-11", true, "agora").unwrap()["pagos"], json!(["2026-11"]));
        assert_eq!(marcar_pago(&mut arq, "fixa-1", "2026-11", true, "agora").unwrap()["pagos"], json!(["2026-11"]));
        assert!(marcar_pago(&mut arq, "fixa-1", "2026-13", true, "agora").is_err());
        let mut e = fixa("TV", 139.9, "pix");
        e.busca = Some(" CLARO ".into());
        let r = editar(&mut arq, "fixa-1", &e, "agora").unwrap();
        assert_eq!((r["busca"].as_str(), r["pagos"].clone()), (Some("CLARO"), json!(["2026-11"])));
        assert_eq!(marcar_pago(&mut arq, "fixa-1", "2026-11", false, "agora").unwrap()["pagos"], json!([]));
        let mut c = fixa("TV", 139.9, "pix");
        c.ativa = false;
        assert_eq!(editar(&mut arq, "fixa-1", &c, "2026-11-16T10:00:00-03:00").unwrap()["cancelada_em"], "2026-11-16");
        assert_eq!(editar(&mut arq, "fixa-1", &c, "2026-12-01T10:00:00-03:00").unwrap()["cancelada_em"], "2026-11-16");
        c.ativa = true;
        assert!(editar(&mut arq, "fixa-1", &c, "agora").unwrap()["cancelada_em"].is_null());
        assert_eq!(ignorar(&mut arq, "TINDER", true, "agora").unwrap(), vec!["TINDER".to_string()]);
        assert_eq!(ignorar(&mut arq, "TINDER", true, "agora").unwrap().len(), 1);
        assert!(ignorar(&mut arq, "TINDER", false, "agora").unwrap().is_empty());
        assert!(ignorar(&mut arq, " ", true, "agora").is_err());
        excluir(&mut arq, "fixa-1", "agora").unwrap();
        assert!(excluir(&mut arq, "fixa-1", "agora").is_err());
    }
}
