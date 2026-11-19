//! Empréstimos entre pessoas: quem me deve e a quem eu devo.
//!
//! Ficam no arquivo `emprestimos` (`{ "emprestimos": [...] }`), anotados à mão.
//! Cada empréstimo guarda os pagamentos recebidos ou feitos; o que falta é
//! `valor − soma dos pagamentos`, e chegando a zero ele fica quitado.
//! Não entram no patrimônio: aparecem à parte.

use serde::Deserialize;
use serde_json::{json, Value};

/// Diferença abaixo de meio centavo conta como zero.
const CENTAVO: f64 = 0.005;

#[derive(Debug, PartialEq)]
pub enum Falha {
    Invalido(String),
    NaoEncontrado(&'static str),
    /// O pedido não combina com o estado atual (ex.: migrar o que já foi migrado).
    Conflito(String),
}

fn invalido(msg: impl Into<String>) -> Falha {
    Falha::Invalido(msg.into())
}

#[derive(Debug, Deserialize)]
pub struct NovoEmprestimo {
    pub pessoa: String,
    /// `me_deve` ou `eu_devo`.
    pub direcao: String,
    pub descricao: Option<String>,
    pub valor: f64,
    pub data: String,
    pub vencimento: Option<String>,
    pub obs: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NovoPagamento {
    pub valor: f64,
    pub data: String,
    pub obs: Option<String>,
}

fn r2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn data_valida(s: &str) -> bool {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

fn texto(s: &Option<String>) -> Value {
    match s.as_deref().map(str::trim) {
        Some(x) if !x.is_empty() => json!(x),
        _ => Value::Null,
    }
}

fn reais(v: f64) -> String {
    let c = (v.abs() * 100.0).round() as i64;
    let int = (c / 100).to_string();
    let mut com_pontos = String::new();
    for (i, ch) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            com_pontos.push('.');
        }
        com_pontos.push(ch);
    }
    format!("R$ {com_pontos},{:02}", c % 100)
}

fn validar(e: &NovoEmprestimo) -> Result<(), Falha> {
    if e.pessoa.trim().is_empty() {
        return Err(invalido("informe o nome da pessoa"));
    }
    if e.pessoa.trim().chars().count() > 80 {
        return Err(invalido("nome da pessoa muito longo (até 80 caracteres)"));
    }
    if e.direcao != "me_deve" && e.direcao != "eu_devo" {
        return Err(invalido("escolha se a pessoa te deve ou se você deve a ela"));
    }
    if !e.valor.is_finite() || e.valor < 0.01 {
        return Err(invalido("informe um valor maior que zero"));
    }
    if !data_valida(&e.data) {
        return Err(invalido("data do empréstimo inválida"));
    }
    if let Some(v) = e.vencimento.as_deref().filter(|v| !v.is_empty()) {
        if !data_valida(v) {
            return Err(invalido("data de vencimento inválida"));
        }
    }
    Ok(())
}

/// Soma dos pagamentos já registrados.
pub fn pago(e: &Value) -> f64 {
    r2(e["pagamentos"].as_array().map(|l| l.iter().filter_map(|p| p["valor"].as_f64()).sum()).unwrap_or(0.0))
}

/// Quanto ainda falta pagar.
pub fn falta(e: &Value) -> f64 {
    r2(e["valor"].as_f64().unwrap_or(0.0) - pago(e))
}

fn atualizar_situacao(e: &mut Value) {
    e["situacao"] = json!(if falta(e) <= CENTAVO { "quitado" } else { "aberto" });
}

fn lista(arq: &mut Value) -> &mut Vec<Value> {
    if !arq.is_object() {
        *arq = json!({ "schema_version": 1 });
    }
    if !arq.get("emprestimos").is_some_and(Value::is_array) {
        arq["emprestimos"] = json!([]);
    }
    arq["emprestimos"].as_array_mut().unwrap()
}

fn achar<'a>(arq: &'a mut Value, id: &str) -> Result<&'a mut Value, Falha> {
    lista(arq).iter_mut().find(|x| x["id"].as_str() == Some(id)).ok_or(Falha::NaoEncontrado("empréstimo não encontrado"))
}

fn aplicar(alvo: &mut Value, e: &NovoEmprestimo, agora: &str) {
    alvo["pessoa"] = json!(e.pessoa.trim());
    alvo["direcao"] = json!(e.direcao);
    alvo["descricao"] = texto(&e.descricao);
    alvo["valor"] = json!(r2(e.valor));
    alvo["data"] = json!(e.data);
    alvo["vencimento"] = texto(&e.vencimento);
    alvo["obs"] = texto(&e.obs);
    alvo["atualizado_em"] = json!(agora);
    if !alvo.get("pagamentos").is_some_and(Value::is_array) {
        alvo["pagamentos"] = json!([]);
    }
    atualizar_situacao(alvo);
}

/// Cria um empréstimo e devolve o registro gravado.
pub fn criar(arq: &mut Value, e: &NovoEmprestimo, id: String, agora: &str) -> Result<Value, Falha> {
    validar(e)?;
    let mut novo = json!({ "id": id, "criado_em": agora });
    aplicar(&mut novo, e, agora);
    lista(arq).push(novo.clone());
    arq["atualizado_em"] = json!(agora);
    Ok(novo)
}

/// Altera os dados do empréstimo, mantendo os pagamentos.
pub fn editar(arq: &mut Value, id: &str, e: &NovoEmprestimo, agora: &str) -> Result<Value, Falha> {
    validar(e)?;
    let alvo = achar(arq, id)?;
    let ja_pago = pago(alvo);
    if r2(e.valor) + CENTAVO < ja_pago {
        return Err(invalido(format!("o valor não pode ser menor que o já pago ({})", reais(ja_pago))));
    }
    aplicar(alvo, e, agora);
    let r = alvo.clone();
    arq["atualizado_em"] = json!(agora);
    Ok(r)
}

pub fn excluir(arq: &mut Value, id: &str, agora: &str) -> Result<(), Falha> {
    let l = lista(arq);
    let antes = l.len();
    l.retain(|x| x["id"].as_str() != Some(id));
    if l.len() == antes {
        return Err(Falha::NaoEncontrado("empréstimo não encontrado"));
    }
    arq["atualizado_em"] = json!(agora);
    Ok(())
}

/// Registra um pagamento (parcial ou total). Não aceita pagar mais do que falta.
pub fn pagar(arq: &mut Value, id: &str, p: &NovoPagamento, pid: String, agora: &str) -> Result<Value, Falha> {
    if !p.valor.is_finite() || p.valor < 0.01 {
        return Err(invalido("informe um valor maior que zero"));
    }
    if !data_valida(&p.data) {
        return Err(invalido("data do pagamento inválida"));
    }
    let alvo = achar(arq, id)?;
    let resta = falta(alvo);
    if resta <= CENTAVO {
        return Err(invalido("este empréstimo já está quitado"));
    }
    if r2(p.valor) > resta + CENTAVO {
        return Err(invalido(format!("o pagamento é maior do que falta ({})", reais(resta))));
    }
    if !alvo.get("pagamentos").is_some_and(Value::is_array) {
        alvo["pagamentos"] = json!([]);
    }
    let l = alvo["pagamentos"].as_array_mut().unwrap();
    l.push(json!({ "id": pid, "data": p.data, "valor": r2(p.valor), "obs": texto(&p.obs) }));
    l.sort_by(|a, b| a["data"].as_str().cmp(&b["data"].as_str()));
    alvo["atualizado_em"] = json!(agora);
    atualizar_situacao(alvo);
    let r = alvo.clone();
    arq["atualizado_em"] = json!(agora);
    Ok(r)
}

/// Desfaz um pagamento registrado por engano.
pub fn remover_pagamento(arq: &mut Value, id: &str, pid: &str, agora: &str) -> Result<Value, Falha> {
    let alvo = achar(arq, id)?;
    let Some(l) = alvo["pagamentos"].as_array_mut() else { return Err(Falha::NaoEncontrado("pagamento não encontrado")) };
    let antes = l.len();
    l.retain(|p| p["id"].as_str() != Some(pid));
    if l.len() == antes {
        return Err(Falha::NaoEncontrado("pagamento não encontrado"));
    }
    alvo["atualizado_em"] = json!(agora);
    atualizar_situacao(alvo);
    let r = alvo.clone();
    arq["atualizado_em"] = json!(agora);
    Ok(r)
}

#[cfg(test)]
mod testes {
    use super::*;

    const AGORA: &str = "2026-11-09T10:00:00-03:00";

    fn novo(valor: f64) -> NovoEmprestimo {
        NovoEmprestimo {
            pessoa: "  Pessoa Exemplo ".into(),
            direcao: "me_deve".into(),
            descricao: Some("conserto".into()),
            valor,
            data: "2026-10-01".into(),
            vencimento: Some(String::new()),
            obs: None,
        }
    }

    fn pg(valor: f64) -> NovoPagamento {
        NovoPagamento { valor, data: "2026-10-15".into(), obs: None }
    }

    #[test]
    fn cria_em_arquivo_vazio_e_limpa_campos() {
        let mut arq = Value::Null;
        let e = criar(&mut arq, &novo(300.0), "e1".into(), AGORA).unwrap();
        assert_eq!(e["pessoa"], "Pessoa Exemplo");
        assert_eq!(e["vencimento"], Value::Null);
        assert_eq!(e["situacao"], "aberto");
        assert_eq!(arq["emprestimos"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn pagamentos_parciais_ate_quitar() {
        let mut arq = Value::Null;
        criar(&mut arq, &novo(300.0), "e1".into(), AGORA).unwrap();
        let e = pagar(&mut arq, "e1", &pg(100.10), "p1".into(), AGORA).unwrap();
        assert_eq!(falta(&e), 199.9);
        assert_eq!(e["situacao"], "aberto");
        let e = pagar(&mut arq, "e1", &pg(199.90), "p2".into(), AGORA).unwrap();
        assert_eq!(falta(&e), 0.0);
        assert_eq!(e["situacao"], "quitado");
        assert!(matches!(pagar(&mut arq, "e1", &pg(1.0), "p3".into(), AGORA), Err(Falha::Invalido(_))));
        let e = remover_pagamento(&mut arq, "e1", "p2", AGORA).unwrap();
        assert_eq!(e["situacao"], "aberto");
    }

    #[test]
    fn recusa_pagamento_maior_que_o_saldo() {
        let mut arq = Value::Null;
        criar(&mut arq, &novo(1500.0), "e1".into(), AGORA).unwrap();
        let r = pagar(&mut arq, "e1", &pg(1500.01), "p1".into(), AGORA);
        assert_eq!(r, Err(Falha::Invalido("o pagamento é maior do que falta (R$ 1.500,00)".into())));
    }

    #[test]
    fn editar_nao_deixa_valor_abaixo_do_pago() {
        let mut arq = Value::Null;
        criar(&mut arq, &novo(300.0), "e1".into(), AGORA).unwrap();
        pagar(&mut arq, "e1", &pg(200.0), "p1".into(), AGORA).unwrap();
        assert!(editar(&mut arq, "e1", &novo(150.0), AGORA).is_err());
        let e = editar(&mut arq, "e1", &novo(200.0), AGORA).unwrap();
        assert_eq!(e["situacao"], "quitado");
        assert_eq!(e["pagamentos"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn validacoes() {
        let mut arq = Value::Null;
        let mut e = novo(10.0);
        e.direcao = "outro".into();
        assert!(criar(&mut arq, &e, "x".into(), AGORA).is_err());
        let mut e = novo(0.0);
        assert!(criar(&mut arq, &e, "x".into(), AGORA).is_err());
        e = novo(10.0);
        e.pessoa = " ".into();
        assert!(criar(&mut arq, &e, "x".into(), AGORA).is_err());
        e = novo(10.0);
        e.data = "01/10/2026".into();
        assert!(criar(&mut arq, &e, "x".into(), AGORA).is_err());
        assert_eq!(excluir(&mut arq, "nao-existe", AGORA), Err(Falha::NaoEncontrado("empréstimo não encontrado")));
    }

    #[test]
    fn formata_reais() {
        assert_eq!(reais(1234567.5), "R$ 1.234.567,50");
        assert_eq!(reais(0.3), "R$ 0,30");
    }
}
