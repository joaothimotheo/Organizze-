//! Dívidas: tipos (os padrão e os criados por você), sugestões recusadas e o pagamento de uma
//! dívida quando um lançamento é ligado a ela.
//!
//! Tudo aqui é puro e mexe só em `dividas.json` (em memória); quem grava é o handler.

pub use crate::emprestimos::Falha;
use crate::categorias::{chave_grupo, slug};
use chrono::{Datelike, NaiveDate};
use serde_json::{json, Value};

/// Tipos que sempre existem e não podem ser apagados: (id, nome).
pub const TIPOS_PADRAO: [(&str, &str); 4] = [("cartao", "Cartão parcelado"), ("emprestimo", "Empréstimos"), ("pessoas", "Com pessoas"), ("outras", "Outras dívidas")];
/// Para onde vão as dívidas de um tipo apagado.
const TIPO_RESERVA: &str = "outras";
const TAMANHO_NOME: usize = 40;
/// Diferença abaixo de meio centavo conta como zero.
const MEIO_CENTAVO: f64 = 0.005;

fn invalido(m: impl Into<String>) -> Falha {
    Falha::Invalido(m.into())
}

fn r2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// A lista `campo` de `dividas.json`, criada se faltar.
fn lista<'a>(dv: &'a mut Value, campo: &str) -> &'a mut Vec<Value> {
    if !dv.is_object() {
        *dv = json!({ "schema_version": 1 });
    }
    if !dv.get(campo).is_some_and(Value::is_array) {
        dv[campo] = json!([]);
    }
    dv[campo].as_array_mut().unwrap()
}

fn achar_divida<'a>(dv: &'a mut Value, id: &str) -> Result<&'a mut Value, Falha> {
    dv.get_mut("dividas")
        .and_then(Value::as_array_mut)
        .and_then(|l| l.iter_mut().find(|d| d["id"].as_str() == Some(id)))
        .ok_or(Falha::NaoEncontrado("dívida não encontrada"))
}

/// Cria um tipo de dívida seu: `{ id: "t_<slug>", nome }`. O nome tem de 1 a 40 letras e não
/// pode repetir outro tipo (nem um padrão), sem diferenciar maiúscula, acento ou espaço.
pub fn criar_tipo(dv: &mut Value, nome: &str, agora: &str) -> Result<Value, Falha> {
    let nome = nome.split_whitespace().collect::<Vec<_>>().join(" ");
    if nome.is_empty() {
        return Err(invalido("dê um nome para o tipo"));
    }
    if nome.chars().count() > TAMANHO_NOME {
        return Err(invalido(format!("o nome do tipo pode ter até {TAMANHO_NOME} letras")));
    }
    let chave = chave_grupo(&nome);
    let tipos = lista(dv, "tipos");
    let repetido = TIPOS_PADRAO.iter().any(|(_, n)| chave_grupo(n) == chave) || tipos.iter().any(|t| chave_grupo(t["nome"].as_str().unwrap_or("")) == chave);
    if repetido {
        return Err(invalido("já existe um tipo com esse nome"));
    }
    let base = format!("t_{}", slug(&nome));
    let ocupado = |id: &str| tipos.iter().any(|t| t["id"].as_str() == Some(id));
    let mut id = base.clone();
    let mut n = 2;
    while ocupado(&id) {
        id = format!("{base}_{n}");
        n += 1;
    }
    let tipo = json!({ "id": id, "nome": nome });
    tipos.push(tipo.clone());
    dv["atualizado_em"] = json!(agora);
    Ok(tipo)
}

/// Apaga um tipo criado por você; as dívidas dele vão para "Outras dívidas". Devolve quantas
/// foram movidas. Os tipos padrão não se apagam.
pub fn apagar_tipo(dv: &mut Value, id: &str, agora: &str) -> Result<usize, Falha> {
    if TIPOS_PADRAO.iter().any(|(p, _)| *p == id) {
        return Err(invalido("os tipos padrão não podem ser apagados"));
    }
    let tipos = lista(dv, "tipos");
    let antes = tipos.len();
    tipos.retain(|t| t["id"].as_str() != Some(id));
    if tipos.len() == antes {
        return Err(Falha::NaoEncontrado("tipo não encontrado"));
    }
    let mut movidas = 0;
    for d in lista(dv, "dividas").iter_mut().filter(|d| d["tipo"].as_str() == Some(id)) {
        d["tipo"] = json!(TIPO_RESERVA);
        movidas += 1;
    }
    dv["atualizado_em"] = json!(agora);
    Ok(movidas)
}

/// "Não é desta dívida": guarda a sugestão recusada em `recusados` para não sugerir de novo.
pub fn recusar(dv: &mut Value, divida_id: &str, lancamento_id: &str) -> Result<(), Falha> {
    if lancamento_id.trim().is_empty() {
        return Err(invalido("informe o lançamento"));
    }
    achar_divida(dv, divida_id)?;
    let recusados = lista(dv, "recusados");
    if !recusados.iter().any(|r| r["divida"].as_str() == Some(divida_id) && r["lancamento"].as_str() == Some(lancamento_id)) {
        recusados.push(json!({ "divida": divida_id, "lancamento": lancamento_id }));
    }
    Ok(())
}

/// Mesmo dia `meses` meses depois (ou antes, se negativo); sem esse dia no mês, o último dia.
fn somar_meses(data: NaiveDate, meses: i32) -> NaiveDate {
    let total = data.year() * 12 + data.month0() as i32 + meses;
    let (ano, mes) = (total.div_euclid(12), total.rem_euclid(12) as u32 + 1);
    (1..=data.day()).rev().find_map(|d| NaiveDate::from_ymd_opt(ano, mes, d)).unwrap_or(data)
}

/// `proximo_vencimento` avançado `meses` meses; o que não é data fica como está.
fn avancar_vencimento(v: &Value, meses: i32) -> Value {
    match v.as_str().and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()) {
        Some(d) => json!(somar_meses(d, meses).to_string()),
        None => v.clone(),
    }
}

/// Parcelas restantes depois de `n` pagamentos (mínimo 0); sem parcelas, continua sem.
fn baixar_parcelas(v: &Value, n: u64) -> Value {
    match v.as_u64() {
        Some(p) => json!(p.saturating_sub(n)),
        None => v.clone(),
    }
}

/// O saldo mais recente que passa no filtro (na mesma data, o registrado por último).
fn mais_recente(d: &Value, filtro: impl Fn(&Value) -> bool) -> Option<&Value> {
    d["saldos"].as_array()?.iter().filter(|s| s["data"].as_str().is_some() && filtro(s)).max_by(|a, b| a["data"].as_str().cmp(&b["data"].as_str()))
}

/// O registro do último saldo (o de data mais recente), venha de onde vier.
pub fn ultimo_registro_saldo(d: &Value) -> Option<&Value> {
    mais_recente(d, |_| true)
}

/// Último saldo (o de data mais recente).
#[cfg(test)]
fn ultimo_saldo(d: &Value) -> Option<f64> {
    ultimo_registro_saldo(d)?["saldo_devedor"].as_f64()
}

/// Data do último saldo informado por você ou vindo de um documento (não o estimado a partir de
/// um lançamento): o que foi pago até esse dia já está descontado dele.
fn data_do_saldo_informado(d: &Value) -> Option<String> {
    mais_recente(d, |s| s["origem"]["tipo"] != "lancamento")?["data"].as_str().map(String::from)
}

/// Dívida com parcelas quita quando elas acabam; sem parcelas, quando o saldo chega a zero.
fn quitou(parcelas: &Value, saldo: Option<f64>) -> bool {
    match parcelas.as_u64() {
        Some(p) => p == 0,
        None => saldo.is_some_and(|s| s < MEIO_CENTAVO),
    }
}

fn registrar_pagamento(d: &mut Value, pagamento: Value) {
    if !d["pagamentos"].is_array() {
        d["pagamentos"] = json!([]);
    }
    d["pagamentos"].as_array_mut().unwrap().push(pagamento);
}

fn antes_de(d: &Value) -> Value {
    json!({ "parcelas_restantes": d["parcelas_restantes"], "proximo_vencimento": d["proximo_vencimento"], "situacao": d["situacao"] })
}

/// Paga a dívida com o lançamento `lanc` (um gasto ligado a ela): com parcelas, uma a menos e
/// o vencimento um mês adiante; o saldo estimado cai o valor do lançamento (na data dele, ou na
/// do último saldo, se for mais recente, para a redução não se perder; nunca abaixo de zero). A
/// dívida com parcelas fica quitada quando elas acabam; a sem parcelas, quando o saldo zera.
/// Lançamento até a data do último saldo informado (já descontado dele) só entra no registro,
/// marcado `so_historico`, sem mexer em parcelas, vencimento e saldo. Devolve o estado anterior
/// (`divida_antes`), que o vínculo guarda para desfazer. Pagar de novo com o mesmo lançamento
/// não paga duas vezes.
pub fn pagar(dv: &mut Value, divida_id: &str, lanc: &Value) -> Result<Value, Falha> {
    let lid = lanc["id"].as_str().unwrap_or("").to_string();
    let d = achar_divida(dv, divida_id)?;
    if let Some(p) = d["pagamentos"].as_array().and_then(|l| l.iter().find(|p| p["lancamento_id"].as_str() == Some(lid.as_str()))) {
        return Ok(p["antes"].clone());
    }
    if lanc["valor"].as_f64().unwrap_or(0.0) >= 0.0 {
        return Err(invalido("esse lançamento é uma entrada: só um gasto paga uma dívida"));
    }
    if d["situacao"] == "quitada" {
        return Err(invalido("essa dívida já está quitada"));
    }
    let mut antes = antes_de(d);
    let valor = r2(lanc["valor"].as_f64().unwrap_or(0.0).abs());
    let data = lanc["data"].as_str().unwrap_or("").to_string();
    if data_do_saldo_informado(d).is_some_and(|base| data <= base) {
        antes["so_historico"] = json!(true);
        registrar_pagamento(d, json!({ "lancamento_id": lid, "data": data, "valor": valor, "antes": antes, "so_historico": true }));
        return Ok(antes);
    }
    d["parcelas_restantes"] = baixar_parcelas(&d["parcelas_restantes"], 1);
    d["proximo_vencimento"] = avancar_vencimento(&d["proximo_vencimento"], 1);
    let ultimo = ultimo_registro_saldo(d).map(|s| (s["data"].as_str().unwrap_or("").to_string(), s["saldo_devedor"].as_f64()));
    let saldo_anterior = ultimo.as_ref().and_then(|(_, v)| *v);
    let mut novo = None;
    if let (Some((data_ultimo, _)), Some(valor_ultimo)) = (&ultimo, saldo_anterior) {
        let saldo = r2((valor_ultimo - valor).max(0.0));
        let data_saldo = data.as_str().max(data_ultimo.as_str()).to_string();
        let saldos = d["saldos"].as_array_mut().unwrap();
        saldos.push(json!({ "data": data_saldo, "saldo_devedor": saldo, "status": "estimado", "origem": { "tipo": "lancamento", "id": lid } }));
        saldos.sort_by(|a, b| a["data"].as_str().cmp(&b["data"].as_str()));
        novo = Some(saldo);
    }
    if quitou(&d["parcelas_restantes"], novo) {
        d["situacao"] = json!("quitada");
    }
    registrar_pagamento(d, json!({ "lancamento_id": lid, "data": data, "valor": valor, "antes": antes, "saldo_anterior": saldo_anterior }));
    Ok(antes)
}

/// A dívida foi editada à mão: os pagamentos já registrados, se desfeitos, não mexem mais em
/// parcelas, vencimento e situação (o que você escreveu vale).
pub fn marcar_editada(d: &mut Value) {
    for p in d.get_mut("pagamentos").and_then(Value::as_array_mut).into_iter().flatten() {
        p["editada_depois"] = json!(true);
    }
}

fn tirar_saldo_do_lancamento(d: &mut Value, lancamento_id: &str) {
    if let Some(saldos) = d.get_mut("saldos").and_then(Value::as_array_mut) {
        saldos.retain(|s| !(s["origem"]["tipo"] == "lancamento" && s["origem"]["id"].as_str() == Some(lancamento_id)));
    }
}

/// Desfaz o pagamento feito pelo lançamento `lancamento_id`: tira o saldo e o registro dele e
/// volta parcelas, vencimento e situação ao que eram (`antes`). Os pagamentos que vieram depois
/// continuam valendo: a cadeia deles é refeita a partir do estado de antes deste (parcelas,
/// vencimento e saldos estimados, um a um; os que só entraram no histórico ficam como estão).
/// Pagamento de antes de editar a dívida à mão só sai do registro e dos saldos; o que só entrou
/// no histórico só sai do registro. Sem registro do pagamento, nada a desfazer.
pub fn desfazer_pagamento(dv: &mut Value, divida_id: &str, lancamento_id: &str, antes: &Value) -> Result<(), Falha> {
    let d = achar_divida(dv, divida_id)?;
    let Some(pags) = d.get_mut("pagamentos").and_then(Value::as_array_mut) else { return Ok(()) };
    let Some(i) = pags.iter().position(|p| p["lancamento_id"].as_str() == Some(lancamento_id)) else { return Ok(()) };
    let p = pags.remove(i);
    if p["so_historico"] == true {
        return Ok(());
    }
    let antes = if p["antes"].is_object() { p["antes"].clone() } else { antes.clone() };
    if p["editada_depois"] == true || !antes.is_object() {
        tirar_saldo_do_lancamento(d, lancamento_id);
        return Ok(());
    }
    // Refaz a cadeia dos pagamentos seguintes, na ordem em que foram registrados.
    let mut parcelas = antes["parcelas_restantes"].clone();
    let mut vencimento = antes["proximo_vencimento"].clone();
    let mut saldo = p["saldo_anterior"].as_f64();
    let mut recalculados: Vec<(String, f64)> = vec![];
    let mut refeitos = 0;
    for j in pags[i..].iter_mut().filter(|j| j["so_historico"] != true) {
        refeitos += 1;
        j["antes"] = json!({ "parcelas_restantes": parcelas, "proximo_vencimento": vencimento, "situacao": antes["situacao"] });
        parcelas = baixar_parcelas(&parcelas, 1);
        vencimento = avancar_vencimento(&vencimento, 1);
        if let Some(s) = saldo {
            j["saldo_anterior"] = json!(s);
            let novo = r2((s - j["valor"].as_f64().unwrap_or(0.0)).max(0.0));
            recalculados.push((j["lancamento_id"].as_str().unwrap_or("").to_string(), novo));
            saldo = Some(novo);
        }
    }
    let quitada = refeitos > 0 && quitou(&parcelas, recalculados.last().map(|(_, s)| *s));
    d["parcelas_restantes"] = parcelas;
    d["proximo_vencimento"] = vencimento;
    d["situacao"] = if quitada { json!("quitada") } else { antes["situacao"].clone() };
    tirar_saldo_do_lancamento(d, lancamento_id);
    for s in d.get_mut("saldos").and_then(Value::as_array_mut).into_iter().flatten() {
        if s["origem"]["tipo"] != "lancamento" {
            continue;
        }
        if let Some((_, novo)) = recalculados.iter().find(|(id, _)| s["origem"]["id"].as_str() == Some(id.as_str())) {
            s["saldo_devedor"] = json!(novo);
        }
    }
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;

    fn msg<T: std::fmt::Debug>(r: Result<T, Falha>) -> String {
        match r {
            Err(Falha::Invalido(m)) => m,
            outro => panic!("esperava Invalido, veio {outro:?}"),
        }
    }

    fn arquivo() -> Value {
        json!({ "dividas": [
            { "id": "d1", "nome": "Carro", "tipo": "emprestimo", "situacao": "ativa", "parcelas_restantes": 10, "proximo_vencimento": "2026-01-31",
              "saldos": [{ "data": "2026-01-01", "saldo_devedor": 1000.0, "status": "estimado", "origem": { "tipo": "informado" } }] },
            { "id": "d2", "nome": "Cartão da loja", "tipo": "t_loja", "situacao": "ativa", "parcelas_restantes": null, "proximo_vencimento": null,
              "saldos": [{ "data": "2026-01-01", "saldo_devedor": 300.0, "status": "estimado", "origem": { "tipo": "informado" } }] },
            { "id": "d3", "nome": "Outra da loja", "tipo": "t_loja", "situacao": "ativa" }
        ], "tipos": [{ "id": "t_loja", "nome": "Loja" }] })
    }

    fn lanc(id: &str, data: &str, valor: f64) -> Value {
        json!({ "id": id, "data": data, "valor": valor })
    }

    fn divida(dv: &Value, id: &str) -> Value {
        dv["dividas"].as_array().unwrap().iter().find(|d| d["id"] == id).unwrap().clone()
    }

    #[test]
    fn criar_tipo_valida_nome() {
        let mut dv = arquivo();
        assert_eq!(msg(criar_tipo(&mut dv, "   ", "agora")), "dê um nome para o tipo");
        assert_eq!(msg(criar_tipo(&mut dv, &"a".repeat(41), "agora")), "o nome do tipo pode ter até 40 letras");
        assert_eq!(msg(criar_tipo(&mut dv, "empréstimos", "agora")), "já existe um tipo com esse nome");
        assert_eq!(msg(criar_tipo(&mut dv, "Cartão Parcelado", "agora")), "já existe um tipo com esse nome");
        assert_eq!(msg(criar_tipo(&mut dv, "  LOJA ", "agora")), "já existe um tipo com esse nome");
        assert_eq!(dv, arquivo(), "recusado não mexe");
        let t = criar_tipo(&mut dv, "  Financiamento   da casa ", "agora").unwrap();
        assert_eq!(t, json!({ "id": "t_financiamento_da_casa", "nome": "Financiamento da casa" }));
        assert_eq!(dv["tipos"][1], t);
        assert_eq!(dv["atualizado_em"], "agora");
        assert!(criar_tipo(&mut dv, &"á".repeat(40), "agora").is_ok(), "40 letras cabem");
        // Id ocupado (nome diferente que dá o mesmo slug): ganha sufixo.
        let t = criar_tipo(&mut dv, "Financiamento-da casa!", "agora").unwrap();
        assert_eq!(t["id"], "t_financiamento_da_casa_2");
        // Arquivo vazio: cria a lista.
        let mut vazio = Value::Null;
        assert_eq!(criar_tipo(&mut vazio, "Escola", "agora").unwrap()["id"], "t_escola");
        assert_eq!(vazio["tipos"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn apagar_tipo_move_para_outras() {
        let mut dv = arquivo();
        assert_eq!(apagar_tipo(&mut dv, "t_loja", "agora").unwrap(), 2);
        assert_eq!(dv["tipos"], json!([]));
        assert_eq!((divida(&dv, "d2")["tipo"].as_str(), divida(&dv, "d3")["tipo"].as_str()), (Some("outras"), Some("outras")));
        assert_eq!(divida(&dv, "d1")["tipo"], "emprestimo", "outro tipo não muda");
        assert_eq!(dv["atualizado_em"], "agora");
        assert_eq!(apagar_tipo(&mut dv, "t_loja", "agora"), Err(Falha::NaoEncontrado("tipo não encontrado")));
        for (id, _) in TIPOS_PADRAO {
            assert_eq!(msg(apagar_tipo(&mut dv, id, "agora")), "os tipos padrão não podem ser apagados");
        }
    }

    #[test]
    fn recusar_nao_repete() {
        let mut dv = arquivo();
        recusar(&mut dv, "d1", "m1").unwrap();
        recusar(&mut dv, "d1", "m1").unwrap();
        recusar(&mut dv, "d2", "m1").unwrap();
        assert_eq!(dv["recusados"], json!([{ "divida": "d1", "lancamento": "m1" }, { "divida": "d2", "lancamento": "m1" }]));
        assert_eq!(recusar(&mut dv, "nao-existe", "m1"), Err(Falha::NaoEncontrado("dívida não encontrada")));
        assert_eq!(msg(recusar(&mut dv, "d1", " ")), "informe o lançamento");
    }

    #[test]
    fn pagar_baixa_parcela_e_avanca_vencimento() {
        let mut dv = arquivo();
        let antes = pagar(&mut dv, "d1", &lanc("m1", "2026-01-30", -250.0)).unwrap();
        assert_eq!(antes, json!({ "parcelas_restantes": 10, "proximo_vencimento": "2026-01-31", "situacao": "ativa" }));
        let d = divida(&dv, "d1");
        assert_eq!(d["parcelas_restantes"], 9);
        assert_eq!(d["proximo_vencimento"], "2026-02-28", "31/01 vira o último dia de fevereiro");
        assert_eq!(d["saldos"][1], json!({ "data": "2026-01-30", "saldo_devedor": 750.0, "status": "estimado", "origem": { "tipo": "lancamento", "id": "m1" } }));
        assert_eq!(d["pagamentos"], json!([{ "lancamento_id": "m1", "data": "2026-01-30", "valor": 250.0, "antes": antes, "saldo_anterior": 1000.0 }]));
        assert_eq!(d["situacao"], "ativa");
        // Mesmo lançamento de novo: não paga duas vezes.
        assert_eq!(pagar(&mut dv, "d1", &lanc("m1", "2026-01-30", -250.0)).unwrap(), antes);
        assert_eq!(divida(&dv, "d1"), d);
        // Ano bissexto e virada de ano.
        assert_eq!(somar_meses(NaiveDate::from_ymd_opt(2028, 1, 31).unwrap(), 1).to_string(), "2028-02-29");
        assert_eq!(somar_meses(NaiveDate::from_ymd_opt(2026, 12, 15).unwrap(), 1).to_string(), "2027-01-15");
        assert_eq!(somar_meses(NaiveDate::from_ymd_opt(2027, 1, 15).unwrap(), -1).to_string(), "2026-12-15");
        // Parcela zero continua zero; sem saldo, não cria saldo.
        let mut dv = json!({ "dividas": [{ "id": "z", "situacao": "ativa", "parcelas_restantes": 0, "proximo_vencimento": "2026-03-10" }] });
        pagar(&mut dv, "z", &lanc("m2", "2026-03-09", -10.0)).unwrap();
        let z = divida(&dv, "z");
        assert_eq!((z["parcelas_restantes"].as_u64(), z["proximo_vencimento"].as_str(), z.get("saldos")), (Some(0), Some("2026-04-10"), None));
        assert_eq!(z["pagamentos"][0]["lancamento_id"], "m2");
        assert_eq!(pagar(&mut dv, "nao-existe", &lanc("m2", "2026-03-09", -10.0)), Err(Falha::NaoEncontrado("dívida não encontrada")));
    }

    #[test]
    fn pagar_sem_parcelas_abate_saldo_e_quita_no_zero() {
        let mut dv = arquivo();
        pagar(&mut dv, "d2", &lanc("m1", "2026-02-10", -100.0)).unwrap();
        let d = divida(&dv, "d2");
        assert_eq!((d["parcelas_restantes"].clone(), d["proximo_vencimento"].clone()), (Value::Null, Value::Null));
        assert_eq!(d["saldos"][1]["saldo_devedor"], 200.0);
        assert_eq!(d["situacao"], "ativa");
        // Passa do saldo: fica em zero e quita.
        pagar(&mut dv, "d2", &lanc("m2", "2026-02-20", -250.0)).unwrap();
        let d = divida(&dv, "d2");
        assert_eq!(d["saldos"][2]["saldo_devedor"], 0.0);
        assert_eq!(d["situacao"], "quitada");
        assert_eq!(msg(pagar(&mut dv, "d2", &lanc("m3", "2026-02-21", -1.0))), "essa dívida já está quitada");
    }

    #[test]
    fn desfazer_restaura_exatamente() {
        let original = arquivo();
        let mut dv = original.clone();
        let antes = pagar(&mut dv, "d1", &lanc("m1", "2026-01-30", -250.0)).unwrap();
        desfazer_pagamento(&mut dv, "d1", "m1", &antes).unwrap();
        let mut esperado = divida(&original, "d1");
        esperado["pagamentos"] = json!([]);
        assert_eq!(divida(&dv, "d1"), esperado);
        // Quitada pelo pagamento: volta a ativa.
        let mut dv = original.clone();
        let antes = pagar(&mut dv, "d2", &lanc("m1", "2026-02-10", -300.0)).unwrap();
        assert_eq!(divida(&dv, "d2")["situacao"], "quitada");
        desfazer_pagamento(&mut dv, "d2", "m1", &antes).unwrap();
        assert_eq!(divida(&dv, "d2")["situacao"], "ativa");
        assert_eq!(divida(&dv, "d2")["saldos"], divida(&original, "d2")["saldos"]);
        // Sem registro do pagamento: nada a desfazer.
        let mut dv = original.clone();
        desfazer_pagamento(&mut dv, "d1", "m9", &json!({ "parcelas_restantes": 1 })).unwrap();
        assert_eq!(dv, original);
    }

    #[test]
    fn dois_pagamentos_no_mes_desfazer_um_restaura_so_o_dele() {
        let mut dv = arquivo();
        let antes1 = pagar(&mut dv, "d1", &lanc("m1", "2026-01-30", -100.0)).unwrap();
        let antes2 = pagar(&mut dv, "d1", &lanc("m2", "2026-01-30", -200.0)).unwrap();
        let d = divida(&dv, "d1");
        assert_eq!((d["parcelas_restantes"].as_u64(), d["proximo_vencimento"].as_str()), (Some(8), Some("2026-03-28")));
        // Desfaz o primeiro: o segundo continua valendo (uma parcela a menos, um mês adiante).
        desfazer_pagamento(&mut dv, "d1", "m1", &antes1).unwrap();
        let d = divida(&dv, "d1");
        assert_eq!((d["parcelas_restantes"].as_u64(), d["proximo_vencimento"].as_str()), (Some(9), Some("2026-02-28")));
        let ids: Vec<&str> = d["saldos"].as_array().unwrap().iter().filter_map(|s| s["origem"]["id"].as_str()).collect();
        assert_eq!(ids, vec!["m2"], "tira só o saldo do primeiro, mesmo na mesma data");
        assert_eq!(d["saldos"][1]["saldo_devedor"], 800.0, "o saldo do segundo é refeito sem o primeiro");
        assert_eq!(d["pagamentos"].as_array().unwrap().len(), 1);
        assert_eq!(d["pagamentos"][0]["lancamento_id"], "m2");
        // Desfazer o segundo agora volta ao estado de antes dos dois.
        desfazer_pagamento(&mut dv, "d1", "m2", &antes2).unwrap();
        let mut esperado = divida(&arquivo(), "d1");
        esperado["pagamentos"] = json!([]);
        assert_eq!(divida(&dv, "d1"), esperado);
    }

    fn estado(dv: &Value) -> (Option<u64>, Option<String>, Vec<(String, f64)>, String) {
        let d = divida(dv, "d1");
        let saldos = d["saldos"].as_array().unwrap().iter().filter(|s| s["origem"]["tipo"] == "lancamento").map(|s| (s["origem"]["id"].as_str().unwrap().to_string(), s["saldo_devedor"].as_f64().unwrap())).collect();
        (d["parcelas_restantes"].as_u64(), d["proximo_vencimento"].as_str().map(String::from), saldos, d["situacao"].as_str().unwrap_or("").to_string())
    }

    fn s(id: &str, v: f64) -> (String, f64) {
        (id.to_string(), v)
    }

    #[test]
    fn desfazer_fora_de_ordem_refaz_a_cadeia() {
        let mut dv = arquivo();
        let a = pagar(&mut dv, "d1", &lanc("A", "2026-01-10", -100.0)).unwrap();
        pagar(&mut dv, "d1", &lanc("B", "2026-02-10", -100.0)).unwrap();
        let c = pagar(&mut dv, "d1", &lanc("C", "2026-03-10", -100.0)).unwrap();
        assert_eq!(estado(&dv), (Some(7), Some("2026-04-28".into()), vec![s("A", 900.0), s("B", 800.0), s("C", 700.0)], "ativa".into()));
        // Desfaz A: B e C refeitos a partir do estado de antes de A (31/01 → 28/02 → 28/03).
        desfazer_pagamento(&mut dv, "d1", "A", &a).unwrap();
        assert_eq!(estado(&dv), (Some(8), Some("2026-03-28".into()), vec![s("B", 900.0), s("C", 800.0)], "ativa".into()));
        let d = divida(&dv, "d1");
        assert_eq!(d["pagamentos"][0]["antes"], json!({ "parcelas_restantes": 10, "proximo_vencimento": "2026-01-31", "situacao": "ativa" }));
        assert_eq!(d["pagamentos"][1]["antes"], json!({ "parcelas_restantes": 9, "proximo_vencimento": "2026-02-28", "situacao": "ativa" }));
        // Desfaz C (o último): volta ao estado de antes dele.
        desfazer_pagamento(&mut dv, "d1", "C", &c).unwrap();
        assert_eq!(estado(&dv), (Some(9), Some("2026-02-28".into()), vec![s("B", 900.0)], "ativa".into()));
    }

    #[test]
    fn desfazer_refaz_saldo_e_situacao_dos_seguintes() {
        let mut dv = arquivo();
        dv["dividas"][0]["saldos"][0]["saldo_devedor"] = json!(150.0);
        dv["dividas"][0]["parcelas_restantes"] = Value::Null; // sem parcelas: o saldo decide a quitação
        let a = pagar(&mut dv, "d1", &lanc("A", "2026-01-10", -100.0)).unwrap();
        pagar(&mut dv, "d1", &lanc("B", "2026-02-10", -100.0)).unwrap();
        assert_eq!(estado(&dv), (None, Some("2026-03-28".into()), vec![s("A", 50.0), s("B", 0.0)], "quitada".into()));
        // Sem A, B não quita mais: 150 − 100 = 50.
        desfazer_pagamento(&mut dv, "d1", "A", &a).unwrap();
        assert_eq!(estado(&dv), (None, Some("2026-02-28".into()), vec![s("B", 50.0)], "ativa".into()));
        // E o inverso: desfazer o que não quitava deixa o seguinte quitar.
        let mut dv = arquivo();
        dv["dividas"][0]["saldos"][0]["saldo_devedor"] = json!(150.0);
        dv["dividas"][0]["parcelas_restantes"] = Value::Null; // sem parcelas: o saldo decide a quitação
        let a = pagar(&mut dv, "d1", &lanc("A", "2026-01-10", -10.0)).unwrap();
        pagar(&mut dv, "d1", &lanc("B", "2026-02-10", -140.0)).unwrap();
        assert_eq!(estado(&dv).3, "quitada");
        desfazer_pagamento(&mut dv, "d1", "A", &a).unwrap();
        assert_eq!(estado(&dv), (None, Some("2026-02-28".into()), vec![s("B", 10.0)], "ativa".into()));
    }

    #[test]
    fn desfazer_depois_de_editar_a_divida_so_tira_registro_e_saldo() {
        let mut dv = arquivo();
        let a = pagar(&mut dv, "d1", &lanc("A", "2026-01-10", -100.0)).unwrap();
        // Você editou a dívida: 20 parcelas, vencimento em 15/06.
        {
            let d = achar_divida(&mut dv, "d1").unwrap();
            d["parcelas_restantes"] = json!(20);
            d["proximo_vencimento"] = json!("2026-06-15");
            marcar_editada(d);
        }
        assert_eq!(divida(&dv, "d1")["pagamentos"][0]["editada_depois"], true);
        desfazer_pagamento(&mut dv, "d1", "A", &a).unwrap();
        assert_eq!(estado(&dv), (Some(20), Some("2026-06-15".into()), vec![], "ativa".into()));
        assert_eq!(divida(&dv, "d1")["pagamentos"], json!([]));
        // Dívida sem pagamentos: marcar não cria nada.
        let mut d = json!({ "id": "x" });
        marcar_editada(&mut d);
        assert_eq!(d, json!({ "id": "x" }));
    }

    #[test]
    fn entrada_nao_paga_divida() {
        let mut dv = arquivo();
        assert_eq!(msg(pagar(&mut dv, "d1", &lanc("m1", "2026-01-30", 95.0))), "esse lançamento é uma entrada: só um gasto paga uma dívida");
        assert_eq!(msg(pagar(&mut dv, "d1", &lanc("m1", "2026-01-30", 0.0))), "esse lançamento é uma entrada: só um gasto paga uma dívida");
        assert_eq!(dv, arquivo(), "nada muda");
    }

    /// Empréstimo de 9 × 412,80 a 6,3% com saldo = valor presente (2.771,44): os pagamentos somam
    /// mais que o saldo, que chega a zero antes da última parcela.
    fn emprestimo_pv() -> Value {
        json!({ "dividas": [{ "id": "e", "situacao": "ativa", "parcelas_restantes": 9, "proximo_vencimento": "2026-12-19",
            "saldos": [{ "data": "2026-11-19", "saldo_devedor": 2771.44, "status": "estimado", "origem": { "tipo": "informado" } }] }] })
    }

    #[test]
    fn com_parcelas_so_quita_na_ultima() {
        let mut dv = emprestimo_pv();
        let mut antes = vec![];
        for k in 1..=7 {
            let data = somar_meses(NaiveDate::from_ymd_opt(2026, 12, 19).unwrap(), k - 1).to_string();
            antes.push(pagar(&mut dv, "e", &lanc(&format!("m{k}"), &data, -412.8)).unwrap());
        }
        let e = divida(&dv, "e");
        assert_eq!((e["parcelas_restantes"].as_u64(), e["situacao"].as_str()), (Some(2), Some("ativa")), "saldo estimado zerou, mas faltam 2 parcelas");
        assert_eq!(ultimo_saldo(&e), Some(0.0), "saldo estimado não fica negativo");
        antes.push(pagar(&mut dv, "e", &lanc("m8", "2027-07-19", -412.8)).unwrap());
        assert_eq!(divida(&dv, "e")["situacao"], "ativa");
        let a9 = pagar(&mut dv, "e", &lanc("m9", "2027-08-19", -412.8)).unwrap();
        let e = divida(&dv, "e");
        assert_eq!((e["parcelas_restantes"].as_u64(), e["situacao"].as_str()), (Some(0), Some("quitada")), "a 9ª quita");
        desfazer_pagamento(&mut dv, "e", "m9", &a9).unwrap();
        let e = divida(&dv, "e");
        assert_eq!((e["parcelas_restantes"].as_u64(), e["situacao"].as_str()), (Some(1), Some("ativa")), "desfazer a 9ª volta para ativa");
        // Refazendo a cadeia (desfaz a 1ª com a 9ª paga): continua quitada só se as parcelas zerarem.
        pagar(&mut dv, "e", &lanc("m9", "2027-08-19", -412.8)).unwrap();
        desfazer_pagamento(&mut dv, "e", "m1", &antes[0]).unwrap();
        let e = divida(&dv, "e");
        assert_eq!((e["parcelas_restantes"].as_u64(), e["situacao"].as_str()), (Some(1), Some("ativa")), "sem a 1ª, falta uma parcela");
    }

    #[test]
    fn pagamento_ate_o_saldo_informado_so_entra_no_historico() {
        let original = arquivo();
        let mut dv = original.clone();
        // Saldo informado em 01/01 já desconta o que foi pago até esse dia.
        let antes = pagar(&mut dv, "d1", &lanc("H", "2026-01-01", -100.0)).unwrap();
        assert_eq!(antes, json!({ "parcelas_restantes": 10, "proximo_vencimento": "2026-01-31", "situacao": "ativa", "so_historico": true }));
        let d = divida(&dv, "d1");
        assert_eq!((d["parcelas_restantes"].as_u64(), d["proximo_vencimento"].as_str()), (Some(10), Some("2026-01-31")), "não baixa parcela nem avança o vencimento");
        assert_eq!(d["saldos"], divida(&original, "d1")["saldos"], "não mexe no saldo");
        assert_eq!(d["pagamentos"], json!([{ "lancamento_id": "H", "data": "2026-01-01", "valor": 100.0, "antes": antes, "so_historico": true }]));
        // Desfazer só tira o registro.
        desfazer_pagamento(&mut dv, "d1", "H", &antes).unwrap();
        let mut esperado = divida(&original, "d1");
        esperado["pagamentos"] = json!([]);
        assert_eq!(divida(&dv, "d1"), esperado);
        // No meio da cadeia: refazer os seguintes pula o que só entrou no histórico.
        let mut dv = original.clone();
        let a = pagar(&mut dv, "d1", &lanc("A", "2026-01-10", -100.0)).unwrap();
        pagar(&mut dv, "d1", &lanc("H", "2025-12-20", -100.0)).unwrap();
        pagar(&mut dv, "d1", &lanc("B", "2026-02-10", -100.0)).unwrap();
        assert_eq!(estado(&dv), (Some(8), Some("2026-03-28".into()), vec![s("A", 900.0), s("B", 800.0)], "ativa".into()));
        desfazer_pagamento(&mut dv, "d1", "A", &a).unwrap();
        assert_eq!(estado(&dv), (Some(9), Some("2026-02-28".into()), vec![s("B", 900.0)], "ativa".into()));
        assert_eq!(divida(&dv, "d1")["pagamentos"][0]["so_historico"], true);
        // O saldo de um lançamento não conta como informado: pagamento anterior a ele ainda baixa.
        let mut dv = original.clone();
        pagar(&mut dv, "d1", &lanc("B", "2026-02-10", -100.0)).unwrap();
        pagar(&mut dv, "d1", &lanc("A", "2026-01-10", -100.0)).unwrap();
        assert_eq!(divida(&dv, "d1")["parcelas_restantes"], 8);
    }

    #[test]
    fn pagamentos_fora_de_ordem_abatem_os_dois() {
        let mut dv = arquivo();
        pagar(&mut dv, "d2", &lanc("B", "2026-02-20", -50.0)).unwrap();
        let a = pagar(&mut dv, "d2", &lanc("A", "2026-02-10", -100.0)).unwrap();
        let d = divida(&dv, "d2");
        assert_eq!(ultimo_saldo(&d), Some(150.0), "300 − 50 − 100");
        assert_eq!(d["saldos"][2], json!({ "data": "2026-02-20", "saldo_devedor": 150.0, "status": "estimado", "origem": { "tipo": "lancamento", "id": "A" } }), "datado no último saldo para não se perder");
        assert_eq!(d["pagamentos"][1]["data"], "2026-02-10", "o pagamento guarda a data do lançamento");
        desfazer_pagamento(&mut dv, "d2", "A", &a).unwrap();
        assert_eq!(ultimo_saldo(&divida(&dv, "d2")), Some(250.0));
    }
}
