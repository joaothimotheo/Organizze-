//! Edição de um lançamento pelo usuário: partes (dividir entre grupos), vínculo (dívida, pessoa
//! ou conta fixa) e o que a sincronização nunca pode apagar.
//!
//! Tudo aqui é puro: `editar` muda só o lançamento e devolve os `Efeitos` que o handler aplica
//! em `fixas.json`, `emprestimos.json` e `dividas.json`.

use crate::categorias;
pub use crate::emprestimos::Falha;
use crate::importar::brl;
use serde::Deserialize;
use serde_json::{json, Value};

/// Campos escritos por você que a sincronização com o banco nunca apaga.
pub const CAMPOS_DO_USUARIO: [&str; 5] = ["nome", "quem", "partes", "vinculo", "detalhe_antigo"];

const MIN_PARTES: usize = 2;
const MAX_PARTES: usize = 10;
/// Diferença abaixo de meio centavo conta como zero.
const MEIO_CENTAVO: f64 = 0.005;
const TIPOS_VINCULO: [&str; 3] = ["divida", "pessoa", "fixa"];
/// Tamanho máximo de um detalhe (subcategoria), como nos detalhes dos grupos.
const TAMANHO_DETALHE: usize = 40;

/// A que o lançamento está ligado: `divida`, `pessoa` (empréstimo) ou `fixa` (conta fixa).
#[derive(Debug, Deserialize, Clone)]
pub struct Vinculo {
    pub tipo: String,
    pub id: String,
}

/// O que a edição pede para fazer fora de `movimentacoes.json`.
#[derive(Debug, Default, PartialEq)]
pub struct Efeitos {
    /// (id da fixa, mês "aaaa-mm", pago).
    pub fixa: Option<(String, String, bool)>,
    /// Ao trocar de uma fixa para outra: desmarcar a antiga (id, mês, false), antes de `fixa`.
    pub fixa_anterior: Option<(String, String, bool)>,
    /// (id do empréstimo, valor, data, obs): registrar um pagamento; o id dele volta para
    /// `vinculo.pagamento_id`.
    pub pagar_pessoa: Option<(String, f64, String, String)>,
    /// (id do empréstimo, id do pagamento): desfazer o pagamento feito por este lançamento.
    pub desfazer_pessoa: Option<(String, String)>,
    /// Id da dívida a pagar com este lançamento; o estado anterior dela volta para
    /// `vinculo.divida_antes`.
    pub pagar_divida: Option<String>,
    /// (id da dívida, `divida_antes` do vínculo): desfazer o pagamento feito por este lançamento.
    pub desfazer_divida: Option<(String, Value)>,
}

fn r2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn invalido(m: impl Into<String>) -> Falha {
    Falha::Invalido(m.into())
}

/// (valor, categoria) de cada parte; sem partes, o próprio lançamento como parte única.
pub fn partes_de(m: &Value) -> Vec<(f64, String)> {
    let cat = |v: &Value| v["categoria"].as_str().unwrap_or("a_classificar").to_string();
    match m.get("partes").and_then(Value::as_array).filter(|l| !l.is_empty()) {
        Some(l) => l.iter().map(|p| (p["valor"].as_f64().unwrap_or(0.0), cat(p))).collect(),
        None => vec![(m["valor"].as_f64().unwrap_or(0.0), cat(m))],
    }
}

/// Detalhe (subcategoria) escrito por você: espaços repetidos tirados, até 40 letras; vazio
/// vira null (limpa).
pub fn detalhe_escrito(s: &str) -> Result<Value, Falha> {
    let d = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if d.chars().count() > TAMANHO_DETALHE {
        return Err(invalido(format!("o detalhe pode ter até {TAMANHO_DETALHE} letras")));
    }
    Ok(if d.is_empty() { Value::Null } else { json!(d) })
}

/// Confere as partes de um lançamento e devolve-as normalizadas (centavos arredondados,
/// detalhe vazio retirado). `antes` são as partes atuais: uma parte que continua com a mesma
/// categoria e o mesmo detalhe mantém o `detalhe_antigo` que já tinha (o do pedido não vale).
pub fn validar_partes(cats: &Value, natureza: &str, valor: f64, partes: &[Value], antes: &[Value]) -> Result<Vec<Value>, Falha> {
    if !categorias::migrado(cats) {
        return Err(invalido("as partes só valem depois de migrar as categorias"));
    }
    if !matches!(natureza, "despesa" | "receita" | "estorno") {
        return Err(invalido("só gastos e entradas podem ser divididos em partes"));
    }
    if !(MIN_PARTES..=MAX_PARTES).contains(&partes.len()) {
        return Err(invalido(format!("divida em {MIN_PARTES} a {MAX_PARTES} partes")));
    }
    let valor = r2(valor);
    let mut normalizadas = Vec::with_capacity(partes.len());
    for p in partes {
        let v = p["valor"].as_f64().filter(|v| v.is_finite()).ok_or_else(|| invalido("informe o valor de cada parte"))?;
        let v = r2(v);
        if v.abs() < MEIO_CENTAVO {
            return Err(invalido("nenhuma parte pode ser zero"));
        }
        if v.signum() != valor.signum() {
            return Err(invalido("cada parte tem de ter o mesmo sinal do lançamento"));
        }
        let cat = p["categoria"].as_str().map(str::trim).unwrap_or("");
        if !categorias::existe(cats, cat) {
            return Err(invalido("categoria desconhecida"));
        }
        categorias::conferir_tipo(cats, cat, natureza)?;
        let mut n = json!({ "valor": v, "categoria": cat });
        let detalhe = detalhe_escrito(p["subcategoria"].as_str().unwrap_or(""))?;
        if !detalhe.is_null() {
            n["subcategoria"] = detalhe;
        }
        normalizadas.push(n);
    }
    let mut usadas = vec![false; antes.len()];
    for n in normalizadas.iter_mut() {
        let achada = antes.iter().enumerate().position(|(i, a)| {
            !usadas[i]
                && a["categoria"].as_str().map(str::trim) == n["categoria"].as_str()
                && detalhe_escrito(a["subcategoria"].as_str().unwrap_or("")).ok().as_ref() == Some(&n["subcategoria"])
                && a["detalhe_antigo"].as_str().is_some_and(|d| !d.trim().is_empty())
        });
        if let Some(i) = achada {
            usadas[i] = true;
            n["detalhe_antigo"] = antes[i]["detalhe_antigo"].clone();
        }
    }
    let soma = r2(normalizadas.iter().filter_map(|p| p["valor"].as_f64()).sum());
    let diferenca = r2(soma.abs() - valor.abs());
    if diferenca.abs() >= MEIO_CENTAVO {
        let sentido = if diferenca < 0.0 { "falta" } else { "passa" };
        return Err(invalido(format!("as partes somam {}, {sentido} {}", brl(soma.abs()), brl(diferenca.abs()))));
    }
    Ok(normalizadas)
}

/// Categoria do lançamento dividido: a da parte de maior valor (a primeira, no empate); se
/// alguma parte ainda está "a classificar", o lançamento todo continua pendente.
pub fn categoria_principal(partes: &[Value]) -> String {
    if partes.iter().any(|p| p["categoria"] == "a_classificar") {
        return "a_classificar".into();
    }
    principal(partes).and_then(|p| p["categoria"].as_str()).unwrap_or("a_classificar").to_string()
}

/// Subcategoria (detalhe) da parte principal, ou null.
pub fn detalhe_principal(partes: &[Value]) -> Value {
    principal(partes).and_then(|p| p.get("subcategoria")).cloned().unwrap_or(Value::Null)
}

fn principal(partes: &[Value]) -> Option<&Value> {
    let abs = |p: &Value| p["valor"].as_f64().unwrap_or(0.0).abs();
    partes.iter().reduce(|a, b| if abs(b) > abs(a) { b } else { a })
}

/// Mês da competência do lançamento: `competencia`, ou o mês de `data`.
fn competencia(m: &Value) -> String {
    m["competencia"].as_str().filter(|c| !c.is_empty()).map(String::from).unwrap_or_else(|| m["data"].as_str().unwrap_or("").chars().take(7).collect())
}

/// O que fazer com as partes numa edição em que elas não foram pedidas explicitamente: uma
/// categoria única escolhida desfaz a divisão; mudar a natureza mantém as partes só se ainda
/// servem para ela. Chame depois de aplicar categoria e natureza ao lançamento.
pub fn partes_pedidas(m: &Value, cats: &Value, pedido: Option<Option<Vec<Value>>>, mudou_categoria: bool, mudou_natureza: bool) -> Option<Option<Vec<Value>>> {
    let Some(atuais) = m.get("partes").and_then(Value::as_array).filter(|_| pedido.is_none()) else { return pedido };
    let servem = !mudou_categoria
        && (!mudou_natureza || validar_partes(cats, m["natureza"].as_str().unwrap_or(""), m["valor"].as_f64().unwrap_or(0.0), atuais, &[]).is_ok());
    if servem { None } else { Some(None) }
}

/// Muda partes e vínculo de um lançamento. `None` = não mexe; `Some(None)` = remove.
/// Em caso de erro o lançamento fica como estava.
pub fn editar(m: &mut Value, cats: &Value, partes: Option<Option<Vec<Value>>>, vinculo: Option<Option<Vinculo>>) -> Result<Efeitos, Falha> {
    // Confere tudo antes de mexer.
    let novas_partes = match &partes {
        Some(Some(l)) => {
            let natureza = m["natureza"].as_str().unwrap_or("");
            let antes = m.get("partes").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
            Some(validar_partes(cats, natureza, m["valor"].as_f64().unwrap_or(0.0), l, antes)?)
        }
        _ => None,
    };
    let novo_vinculo = match &vinculo {
        Some(Some(v)) => {
            let tipo = v.tipo.trim();
            let id = v.id.trim();
            if !TIPOS_VINCULO.contains(&tipo) {
                return Err(invalido("vínculo deve ser dívida, pessoa ou conta fixa"));
            }
            if id.is_empty() {
                return Err(invalido("informe a que o lançamento está ligado"));
            }
            Some((tipo.to_string(), id.to_string()))
        }
        _ => None,
    };

    match partes {
        Some(Some(_)) => {
            let l = novas_partes.unwrap_or_default();
            m["categoria"] = json!(categoria_principal(&l));
            m["subcategoria"] = detalhe_principal(&l);
            m["classificacao"] = json!("manual");
            m["partes"] = json!(l);
        }
        Some(None) => {
            if let Some(o) = m.as_object_mut() {
                o.remove("partes");
            }
        }
        None => {}
    }

    let mut ef = Efeitos::default();
    let Some(pedido) = vinculo else { return Ok(ef) };
    let atual = m.get("vinculo").filter(|v| v.is_object()).cloned();
    let mesmo = matches!((&atual, &novo_vinculo), (Some(a), Some((t, i))) if a["tipo"].as_str() == Some(t) && a["id"].as_str() == Some(i));
    // Mesma pessoa mas sem pagamento registrado (efeito que não chegou a ser gravado): paga de
    // novo; o id do pagamento é o do lançamento, então nunca duplica.
    let pessoa_sem_pagamento = mesmo && atual.as_ref().is_some_and(|a| a["tipo"] == "pessoa" && a["pagamento_id"].as_str().is_none());
    // Mesma dívida: paga de novo se a dívida não tem o pagamento deste lançamento (vínculo de
    // antes de ter efeito, falha no meio); `dividas::pagar` não paga duas vezes.
    let mesma_divida = mesmo && atual.as_ref().is_some_and(|a| a["tipo"] == "divida");
    if mesmo && !pessoa_sem_pagamento && !mesma_divida {
        return Ok(ef);
    }
    let mes = competencia(m);
    // Desfaz o que o vínculo antigo fez (uma fixa que já estava paga antes de ligar continua paga),
    // no mês em que foi ligado.
    if let Some(a) = atual.as_ref().filter(|_| !mesmo) {
        let id = a["id"].as_str().unwrap_or("").to_string();
        match a["tipo"].as_str() {
            Some("fixa") if a["ja_paga"] != true => ef.fixa = Some((id, mes_da_fixa(m), false)),
            Some("pessoa") => ef.desfazer_pessoa = Some((id, a["pagamento_id"].as_str().map(String::from).unwrap_or_else(|| id_do_pagamento(m)))),
            // Sem `divida_antes`, o vínculo é de antes de ter efeito: nada a desfazer.
            Some("divida") if a["divida_antes"].is_object() => ef.desfazer_divida = Some((id, a["divida_antes"].clone())),
            _ => {}
        }
    }
    match (pedido, novo_vinculo) {
        (Some(_), Some((tipo, id))) => {
            match tipo.as_str() {
                "fixa" => {
                    ef.fixa_anterior = ef.fixa.take();
                    ef.fixa = Some((id.clone(), mes.clone(), true));
                }
                "pessoa" => {
                    let nome = m["nome"].as_str().filter(|n| !n.trim().is_empty()).or(m["descricao"].as_str()).unwrap_or("").trim().to_string();
                    let valor = r2(m["valor"].as_f64().unwrap_or(0.0).abs());
                    let data = m["data"].as_str().unwrap_or("").to_string();
                    ef.pagar_pessoa = Some((id.clone(), valor, data, format!("Lançamento {nome}")));
                }
                "divida" => ef.pagar_divida = Some(id.clone()),
                _ => {}
            }
            m["vinculo"] = json!({ "tipo": tipo, "id": id });
            if tipo == "fixa" {
                m["vinculo"]["mes"] = json!(mes);
            }
        }
        _ => {
            if let Some(o) = m.as_object_mut() {
                o.remove("vinculo");
            }
        }
    }
    Ok(ef)
}

/// Mês marcado pela fixa ligada a este lançamento: o guardado ao ligar (`vinculo.mes`) ou, num
/// vínculo antigo sem ele, o da competência.
pub fn mes_da_fixa(m: &Value) -> String {
    m["vinculo"]["mes"].as_str().filter(|s| !s.is_empty()).map(String::from).unwrap_or_else(|| competencia(m))
}

impl Efeitos {
    /// Não desmarca uma fixa que outro lançamento (de id diferente de `id`) ainda paga no mesmo mês.
    pub fn manter_fixas_ainda_ligadas(&mut self, lista: &[Value], id: &str) {
        let ligada = |(fixa, mes, pago): &(String, String, bool)| {
            !pago && lista.iter().any(|o| o["id"].as_str() != Some(id) && o["vinculo"]["tipo"] == "fixa" && o["vinculo"]["id"].as_str() == Some(fixa.as_str()) && mes_da_fixa(o) == *mes)
        };
        if self.fixa.as_ref().is_some_and(ligada) {
            self.fixa = None;
        }
        if self.fixa_anterior.as_ref().is_some_and(ligada) {
            self.fixa_anterior = None;
        }
    }

    pub fn precisa_fixas(&self) -> bool {
        self.fixa.is_some() || self.fixa_anterior.is_some()
    }
    pub fn precisa_emprestimos(&self) -> bool {
        self.pagar_pessoa.is_some() || self.desfazer_pessoa.is_some()
    }
    pub fn precisa_dividas(&self) -> bool {
        self.pagar_divida.is_some() || self.desfazer_divida.is_some()
    }
}

/// Id do pagamento que um lançamento registra no empréstimo: um por lançamento.
pub fn id_do_pagamento(m: &Value) -> String {
    format!("lanc-{}", m["id"].as_str().unwrap_or(""))
}

/// Desfazer o que já não existe (fixa apagada, pagamento removido à mão) não é erro.
fn tolerar_sumido(r: Result<Value, Falha>) -> Result<(), Falha> {
    match r {
        Ok(_) | Err(Falha::NaoEncontrado(_)) => Ok(()),
        Err(e) => Err(e),
    }
}

fn achar<'a>(arq: &'a Value, lista: &str, id: &str) -> Option<&'a Value> {
    arq.get(lista)?.as_array()?.iter().find(|x| x["id"].as_str() == Some(id))
}

/// Aplica os efeitos de `editar` em `fixas.json`, `emprestimos.json` e `dividas.json` (em
/// memória) e completa o vínculo do lançamento (`pagamento_id`, `ja_paga`, `divida_antes`). Os
/// arquivos que os efeitos não pedem (veja `precisa_fixas` / `precisa_emprestimos` /
/// `precisa_dividas`) não são tocados. Em caso de erro, descarte tudo.
pub fn aplicar(ef: &Efeitos, m: &mut Value, fixas: &mut Value, emprestimos: &mut Value, dividas: &mut Value, agora: &str) -> Result<(), Falha> {
    if let Some((id, mes, pago)) = &ef.fixa_anterior {
        tolerar_sumido(crate::fixas::marcar_pago(fixas, id, mes, *pago, agora))?;
    }
    if let Some((id, mes, pago)) = &ef.fixa {
        if *pago {
            let f = achar(fixas, "fixas", id).ok_or(Falha::NaoEncontrado("conta fixa não encontrada"))?;
            if f["pagos"].as_array().is_some_and(|l| l.iter().any(|x| x.as_str() == Some(mes.as_str()))) {
                // Já estava paga: ao desligar, continua paga.
                m["vinculo"]["ja_paga"] = json!(true);
            } else {
                crate::fixas::marcar_pago(fixas, id, mes, true, agora)?;
            }
        } else {
            tolerar_sumido(crate::fixas::marcar_pago(fixas, id, mes, false, agora))?;
        }
    }
    if let Some((id, pid)) = &ef.desfazer_pessoa {
        tolerar_sumido(crate::emprestimos::remover_pagamento(emprestimos, id, pid, agora))?;
    }
    if let Some((id, valor, data, obs)) = &ef.pagar_pessoa {
        let e = achar(emprestimos, "emprestimos", id).ok_or(Falha::NaoEncontrado("empréstimo não encontrado"))?;
        let gasto = m["valor"].as_f64().unwrap_or(0.0) < 0.0;
        match (gasto, e["direcao"].as_str()) {
            (true, Some("eu_devo")) | (false, Some("me_deve")) => {}
            (true, _) => return Err(invalido("esse lançamento é um gasto: só pode pagar algo que você deve a essa pessoa")),
            (false, _) => return Err(invalido("esse lançamento é uma entrada: só pode receber de quem te deve")),
        }
        let pid = id_do_pagamento(m);
        let ja_existe = e["pagamentos"].as_array().is_some_and(|l| l.iter().any(|p| p["id"].as_str() == Some(pid.as_str())));
        if !ja_existe {
            let p = crate::emprestimos::NovoPagamento { valor: *valor, data: data.clone(), obs: Some(obs.clone()) };
            crate::emprestimos::pagar(emprestimos, id, &p, pid.clone(), agora)?;
        }
        m["vinculo"]["pagamento_id"] = json!(pid);
    }
    let dividas_antes = if ef.precisa_dividas() { dividas.clone() } else { Value::Null };
    if let Some((id, antes)) = &ef.desfazer_divida {
        let lid = m["id"].as_str().unwrap_or("").to_string();
        match crate::dividas::desfazer_pagamento(dividas, id, &lid, antes) {
            Ok(()) | Err(Falha::NaoEncontrado(_)) => {}
            Err(e) => return Err(e),
        }
    }
    if let Some(id) = &ef.pagar_divida {
        let antes = crate::dividas::pagar(dividas, id, m)?;
        m["vinculo"]["divida_antes"] = antes;
    }
    if ef.precisa_dividas() && dividas.is_object() && *dividas != dividas_antes {
        dividas["atualizado_em"] = json!(agora);
    }
    Ok(())
}

/// Desfaz o vínculo de um lançamento que vai ser apagado (pagamento da pessoa, marca da fixa).
/// `outros` são os demais lançamentos: uma fixa que outro deles ainda paga no mês fica marcada.
pub fn desfazer_vinculo(m: &Value, cats: &Value, outros: &[Value], fixas: &mut Value, emprestimos: &mut Value, dividas: &mut Value, agora: &str) -> Result<(), Falha> {
    let mut copia = m.clone();
    let mut ef = editar(&mut copia, cats, None, Some(None))?;
    ef.manter_fixas_ainda_ligadas(outros, m["id"].as_str().unwrap_or(""));
    aplicar(&ef, &mut copia, fixas, emprestimos, dividas, agora)
}

/// A dívida do vínculo tem de existir em `dividas.json`.
pub fn conferir_divida(dividas: &Value, id: &str) -> Result<(), Falha> {
    if achar(dividas, "dividas", id).is_some() { Ok(()) } else { Err(invalido("dívida não encontrada")) }
}

/// "Aplicar também aos outros com a mesma descrição": só pendentes, de mesma descrição
/// (normalizada), do tipo certo, e nunca um lançamento dividido em partes.
pub fn pega_mesma_descricao(m: &Value, desc: &str, cats: &Value, categoria: &str) -> bool {
    m["categoria"] == "a_classificar"
        && m.get("partes").is_none()
        && crate::importar::classificar::normalizar(m["descricao"].as_str().unwrap_or("")) == desc
        && categorias::conferir_tipo(cats, categoria, m["natureza"].as_str().unwrap_or("")).is_ok()
}

/// Põe `categoria` e `detalhe` (null limpa) no lançamento `id` e, com `mesma_descricao`, nos
/// pendentes de mesma descrição (veja `pega_mesma_descricao`). Devolve os ids alterados.
pub fn aplicar_categoria(l: &mut [Value], id: &str, cats: &Value, categoria: &str, detalhe: &Value, mesma_descricao: bool) -> Vec<Value> {
    let desc = l.iter().find(|m| m["id"].as_str() == Some(id)).map(|m| crate::importar::classificar::normalizar(m["descricao"].as_str().unwrap_or(""))).unwrap_or_default();
    let mut alterados = vec![];
    for m in l.iter_mut() {
        let e_este = m["id"].as_str() == Some(id);
        if e_este || (mesma_descricao && pega_mesma_descricao(m, &desc, cats, categoria)) {
            m["categoria"] = json!(categoria);
            m["subcategoria"] = detalhe.clone();
            m["classificacao"] = json!("manual");
            alterados.push(m["id"].clone());
        }
    }
    alterados
}

/// Lançamentos de `antes` ligados a algo do `tipo` que não estão em `depois` (a sincronização
/// os removeu).
fn ligados_que_sumiram<'a>(antes: &'a Value, depois: &Value, tipo: &'a str) -> impl Iterator<Item = &'a Value> {
    let ficaram: std::collections::HashSet<String> = depois["movimentacoes"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().map(String::from)).collect();
    antes["movimentacoes"].as_array().into_iter().flatten().filter(move |m| m["vinculo"]["tipo"] == tipo && m["id"].as_str().is_some_and(|id| !ficaram.contains(id)))
}

/// Lançamentos ligados a uma pessoa que a sincronização removeu: (empréstimo, pagamento) a desfazer.
pub fn pagamentos_sumidos(antes: &Value, depois: &Value) -> Vec<(String, String)> {
    ligados_que_sumiram(antes, depois, "pessoa")
        .filter_map(|m| {
            let pid = m["vinculo"]["pagamento_id"].as_str().map(String::from).unwrap_or_else(|| id_do_pagamento(m));
            Some((m["vinculo"]["id"].as_str()?.to_string(), pid))
        })
        .collect()
}

/// Lançamentos ligados a uma dívida (com efeito, isto é, com `divida_antes`) que a
/// sincronização removeu: (dívida, lançamento, `divida_antes`) a desfazer.
pub fn pagamentos_de_dividas_sumidos(antes: &Value, depois: &Value) -> Vec<(String, String, Value)> {
    ligados_que_sumiram(antes, depois, "divida")
        .filter(|m| m["vinculo"]["divida_antes"].is_object())
        .filter_map(|m| Some((m["vinculo"]["id"].as_str()?.to_string(), m["id"].as_str()?.to_string(), m["vinculo"]["divida_antes"].clone())))
        .collect()
}

#[cfg(test)]
mod testes {
    use super::*;
    use serde_json::{json, Value};

    fn cats() -> Value {
        json!({ "versao": 2, "grupos": [
            { "id": "p_comida", "nome": "Comida", "tipo": "gasto" },
            { "id": "p_casa", "nome": "Casa", "tipo": "gasto" }
        ]})
    }

    fn gasto() -> Value {
        json!({ "id": "m1", "data": "2026-10-30", "competencia": "2026-11", "descricao": "MERCADO EXEMPLO", "valor": -312.45,
            "natureza": "despesa", "categoria": "a_classificar", "subcategoria": null, "classificacao": "baixa" })
    }

    fn parte(valor: f64, categoria: &str) -> Value {
        json!({ "valor": valor, "categoria": categoria })
    }

    fn msg<T: std::fmt::Debug>(r: Result<T, Falha>) -> String {
        match r {
            Err(Falha::Invalido(m)) => m,
            outro => panic!("esperava Invalido, veio {outro:?}"),
        }
    }

    fn vinculo(tipo: &str, id: &str) -> Option<Option<Vinculo>> {
        Some(Some(Vinculo { tipo: tipo.into(), id: id.into() }))
    }

    #[test]
    fn partes_validas_definem_categoria_principal() {
        let mut m = gasto();
        let p = vec![json!({ "valor": -250.0, "categoria": "p_comida", "subcategoria": "  " }), json!({ "valor": -62.449999, "categoria": "p_casa", "subcategoria": "Luz" })];
        let e = editar(&mut m, &cats(), Some(Some(p)), None).unwrap();
        assert!(e.fixa.is_none() && e.pagar_pessoa.is_none() && e.desfazer_pessoa.is_none());
        assert_eq!(m["categoria"], "p_comida");
        assert_eq!(m["classificacao"], "manual");
        assert_eq!(m["partes"], json!([{ "valor": -250.0, "categoria": "p_comida" }, { "valor": -62.45, "categoria": "p_casa", "subcategoria": "Luz" }]));
        // Maior valor absoluto, não a primeira parte.
        let mut m = gasto();
        editar(&mut m, &cats(), Some(Some(vec![parte(-12.45, "p_comida"), parte(-300.0, "p_casa")])), None).unwrap();
        assert_eq!(m["categoria"], "p_casa");
    }

    #[test]
    fn partes_que_nao_fecham_sao_recusadas() {
        let mut m = gasto();
        let antes = m.clone();
        assert_eq!(msg(editar(&mut m, &cats(), Some(Some(vec![parte(-250.0, "p_comida"), parte(-62.44, "p_casa")])), None)), "as partes somam R$ 312,44, falta R$ 0,01");
        assert_eq!(msg(editar(&mut m, &cats(), Some(Some(vec![parte(-250.0, "p_comida"), parte(-1062.46, "p_casa")])), None)), "as partes somam R$ 1.312,46, passa R$ 1.000,01");
        assert_eq!(m, antes, "recusado não mexe no lançamento");
    }

    #[test]
    fn parte_de_outro_tipo_ou_sinal_trocado_e_recusada() {
        let c = cats();
        let mut m = gasto();
        assert_eq!(msg(validar_partes(&c, "despesa", -312.45, &[parte(-250.0, "salario"), parte(-62.45, "p_casa")], &[])), "essa categoria é de entradas");
        assert_eq!(msg(validar_partes(&c, "despesa", -312.45, &[parte(-412.45, "p_comida"), parte(100.0, "p_casa")], &[])), "cada parte tem de ter o mesmo sinal do lançamento");
        assert_eq!(msg(validar_partes(&c, "despesa", -312.45, &[parte(-312.45, "p_comida")], &[])), "divida em 2 a 10 partes");
        let onze: Vec<Value> = (0..11).map(|_| parte(-1.0, "p_comida")).collect();
        assert_eq!(msg(validar_partes(&c, "despesa", -11.0, &onze, &[])), "divida em 2 a 10 partes");
        let dez: Vec<Value> = (0..10).map(|_| parte(-1.0, "p_comida")).collect();
        assert!(validar_partes(&c, "despesa", -10.0, &dez, &[]).is_ok());
        assert_eq!(msg(validar_partes(&c, "despesa", -312.45, &[parte(-312.45, "p_comida"), parte(0.0, "p_casa")], &[])), "nenhuma parte pode ser zero");
        assert_eq!(msg(validar_partes(&c, "despesa", -312.45, &[parte(-312.45, "p_comida"), parte(-0.001, "p_casa")], &[])), "nenhuma parte pode ser zero");
        assert_eq!(msg(validar_partes(&c, "despesa", -312.45, &[parte(-250.0, "lazer"), parte(-62.45, "p_casa")], &[])), "categoria desconhecida");
        assert_eq!(msg(validar_partes(&c, "despesa", -312.45, &[json!({ "valor": "x", "categoria": "p_comida" }), parte(-62.45, "p_casa")], &[])), "informe o valor de cada parte");
        // Entrada: grupo de gasto não serve.
        assert_eq!(msg(validar_partes(&c, "receita", 100.0, &[parte(60.0, "salario"), parte(40.0, "p_casa")], &[])), "essa categoria é de gastos");
        assert!(validar_partes(&c, "estorno", 100.0, &[parte(60.0, "salario"), parte(40.0, "rendimentos_estornos")], &[]).is_ok());
        assert!(editar(&mut m, &c, Some(Some(vec![parte(-250.0, "salario"), parte(-62.45, "p_casa")])), None).is_err());
        assert_eq!(m, gasto());
    }

    #[test]
    fn parte_pendente_deixa_o_lancamento_pendente() {
        let mut m = gasto();
        editar(&mut m, &cats(), Some(Some(vec![parte(-300.0, "p_comida"), parte(-12.45, "a_classificar")])), None).unwrap();
        assert_eq!(m["categoria"], "a_classificar");
        assert_eq!(categoria_principal(&[parte(-1.0, "p_casa"), parte(-5.0, "p_comida")]), "p_comida");
    }

    #[test]
    fn partes_so_depois_de_migrar_e_so_em_gasto_ou_entrada() {
        let p = [parte(-250.0, "outros"), parte(-62.45, "outros")];
        assert_eq!(msg(validar_partes(&json!({}), "despesa", -312.45, &p, &[])), "as partes só valem depois de migrar as categorias");
        assert_eq!(msg(validar_partes(&cats(), "transferencia_interna", -312.45, &p, &[])), "só gastos e entradas podem ser divididos em partes");
        let mut m = gasto();
        m["natureza"] = json!("pagamento_divida");
        assert!(editar(&mut m, &cats(), Some(Some(p.to_vec())), None).is_err());
    }

    #[test]
    fn remover_partes_volta_categoria_unica() {
        let mut m = gasto();
        editar(&mut m, &cats(), Some(Some(vec![parte(-12.45, "p_comida"), parte(-300.0, "p_casa")])), None).unwrap();
        let e = editar(&mut m, &cats(), Some(None), None).unwrap();
        assert!(e.fixa.is_none());
        assert!(m.get("partes").is_none());
        assert_eq!(m["categoria"], "p_casa");
        // Sem partes nem vínculo no pedido: nada muda.
        let antes = m.clone();
        editar(&mut m, &cats(), None, None).unwrap();
        assert_eq!(m, antes);
    }

    #[test]
    fn categoria_unica_ou_natureza_que_nao_serve_desfaz_as_partes() {
        let c = cats();
        let mut m = gasto();
        let p = vec![parte(-250.0, "p_comida"), parte(-62.45, "p_casa")];
        editar(&mut m, &c, Some(Some(p.clone())), None).unwrap();
        assert_eq!(partes_pedidas(&m, &c, None, false, false), None, "só mudar nome ou quem: mantém");
        assert_eq!(partes_pedidas(&m, &c, None, true, false), Some(None), "categoria única: desfaz");
        assert_eq!(partes_pedidas(&m, &c, Some(Some(p.clone())), true, false), Some(Some(p.clone())), "partes pedidas valem");
        assert_eq!(partes_pedidas(&m, &c, None, false, true), None, "natureza igual ainda serve");
        m["natureza"] = json!("transferencia_interna");
        assert_eq!(partes_pedidas(&m, &c, None, false, true), Some(None), "natureza que não serve: desfaz");
        assert_eq!(partes_pedidas(&gasto(), &c, None, true, true), None, "sem partes: nada a fazer");
    }

    #[test]
    fn ligar_fixa_gera_efeito_no_mes_da_competencia() {
        let mut m = gasto();
        let e = editar(&mut m, &cats(), None, vinculo("fixa", "fixa-1")).unwrap();
        assert_eq!(e.fixa, Some(("fixa-1".to_string(), "2026-11".to_string(), true)));
        assert_eq!(m["vinculo"], json!({ "tipo": "fixa", "id": "fixa-1", "mes": "2026-11" }));
        // Ligar de novo à mesma fixa não faz nada.
        let e = editar(&mut m, &cats(), None, vinculo("fixa", "fixa-1")).unwrap();
        assert!(e.fixa.is_none() && e.fixa_anterior.is_none());
        // Trocar de fixa: desmarca a antiga e marca a nova.
        let e = editar(&mut m, &cats(), None, vinculo("fixa", "fixa-2")).unwrap();
        assert_eq!(e.fixa_anterior, Some(("fixa-1".to_string(), "2026-11".to_string(), false)));
        assert_eq!(e.fixa, Some(("fixa-2".to_string(), "2026-11".to_string(), true)));
        let e = editar(&mut m, &cats(), None, Some(None)).unwrap();
        assert_eq!(e.fixa, Some(("fixa-2".to_string(), "2026-11".to_string(), false)));
        assert!(m.get("vinculo").is_none());
        // Sem competência: o mês da data.
        let mut m = gasto();
        m.as_object_mut().unwrap().remove("competencia");
        let e = editar(&mut m, &cats(), None, vinculo("fixa", "fixa-1")).unwrap();
        assert_eq!(e.fixa, Some(("fixa-1".to_string(), "2026-10".to_string(), true)));
    }

    #[test]
    fn ligar_pessoa_gera_pagamento_e_desligar_desfaz_so_o_dele() {
        let mut m = gasto();
        m["valor"] = json!(-95.0);
        m["nome"] = json!("Metade do conserto");
        let e = editar(&mut m, &cats(), None, vinculo("pessoa", "emprestimo-1")).unwrap();
        assert_eq!(e.pagar_pessoa, Some(("emprestimo-1".to_string(), 95.0, "2026-10-30".to_string(), "Lançamento Metade do conserto".to_string())));
        assert!(e.desfazer_pessoa.is_none());
        m["vinculo"]["pagamento_id"] = json!("pg1");
        let e = editar(&mut m, &cats(), None, Some(None)).unwrap();
        assert_eq!(e.desfazer_pessoa, Some(("emprestimo-1".to_string(), "pg1".to_string())));
        assert!(e.pagar_pessoa.is_none());
        assert!(m.get("vinculo").is_none());
        // Sem nome, a descrição; trocar de pessoa desfaz o antigo e paga o novo.
        let mut m = gasto();
        m["valor"] = json!(-95.0);
        editar(&mut m, &cats(), None, vinculo("pessoa", "emprestimo-1")).unwrap();
        m["vinculo"]["pagamento_id"] = json!("pg1");
        let e = editar(&mut m, &cats(), None, vinculo("pessoa", "emprestimo-2")).unwrap();
        assert_eq!(e.desfazer_pessoa, Some(("emprestimo-1".to_string(), "pg1".to_string())));
        assert_eq!(e.pagar_pessoa.unwrap().3, "Lançamento MERCADO EXEMPLO");
        assert_eq!(m["vinculo"], json!({ "tipo": "pessoa", "id": "emprestimo-2" }));
    }

    fn dividas_arq() -> Value {
        json!({ "dividas": [
            { "id": "d1", "situacao": "ativa", "parcelas_restantes": 5, "proximo_vencimento": "2026-11-10",
              "saldos": [{ "data": "2026-10-01", "saldo_devedor": 1000.0, "status": "estimado", "origem": { "tipo": "informado" } }] },
            { "id": "d2", "situacao": "ativa", "parcelas_restantes": null, "proximo_vencimento": null, "saldos": [] }
        ]})
    }

    #[test]
    fn ligar_divida_gera_efeito_e_desligar_desfaz() {
        let mut dv = dividas_arq();
        let mut m = gasto();
        let ef = editar(&mut m, &cats(), None, vinculo("divida", "  d1 ")).unwrap();
        assert_eq!(ef.pagar_divida, Some("d1".to_string()));
        assert!(ef.precisa_dividas() && !ef.precisa_fixas() && !ef.precisa_emprestimos());
        assert_eq!(msg(editar(&mut m.clone(), &cats(), None, vinculo("carro", "x"))), "vínculo deve ser dívida, pessoa ou conta fixa");
        assert_eq!(msg(editar(&mut m.clone(), &cats(), None, vinculo("fixa", "  "))), "informe a que o lançamento está ligado");
        aplicar(&ef, &mut m, &mut Value::Null, &mut Value::Null, &mut dv, "agora").unwrap();
        let antes = json!({ "parcelas_restantes": 5, "proximo_vencimento": "2026-11-10", "situacao": "ativa" });
        assert_eq!(m["vinculo"], json!({ "tipo": "divida", "id": "d1", "divida_antes": antes }));
        let d = &dv["dividas"][0];
        assert_eq!((d["parcelas_restantes"].as_u64(), d["proximo_vencimento"].as_str()), (Some(4), Some("2026-12-10")));
        assert_eq!(d["saldos"][1]["saldo_devedor"], 687.55);
        assert_eq!(d["pagamentos"][0]["lancamento_id"], "m1");
        assert_eq!(dv["atualizado_em"], "agora");
        // Ligar de novo à mesma dívida, com o pagamento já registrado, não paga de novo.
        let mut de_novo = m.clone();
        let ef = editar(&mut de_novo, &cats(), None, vinculo("divida", "d1")).unwrap();
        assert!(ef.desfazer_divida.is_none());
        let mut dv_de_novo = dv.clone();
        aplicar(&ef, &mut de_novo, &mut Value::Null, &mut Value::Null, &mut dv_de_novo, "depois").unwrap();
        assert_eq!(dv_de_novo, dv, "nada muda, nem o carimbo");
        assert_eq!(de_novo["vinculo"], m["vinculo"]);
        // A dívida perdeu o registro (falha parcial antes): ligar de novo paga.
        let mut sem_registro = dv.clone();
        sem_registro["dividas"][0]["pagamentos"] = json!([]);
        aplicar(&ef, &mut de_novo, &mut Value::Null, &mut Value::Null, &mut sem_registro, "agora").unwrap();
        assert_eq!(sem_registro["dividas"][0]["pagamentos"].as_array().unwrap().len(), 1);
        assert_eq!(sem_registro["dividas"][0]["parcelas_restantes"], 3);
        // Trocar de dívida: desfaz a antiga e paga a nova.
        let mut trocado = m.clone();
        let ef = editar(&mut trocado, &cats(), None, vinculo("divida", "d2")).unwrap();
        assert_eq!((ef.desfazer_divida.clone(), ef.pagar_divida.clone()), (Some(("d1".to_string(), antes.clone())), Some("d2".to_string())));
        let mut dv2 = dv.clone();
        aplicar(&ef, &mut trocado, &mut Value::Null, &mut Value::Null, &mut dv2, "agora").unwrap();
        assert_eq!(dv2["dividas"][0]["parcelas_restantes"], 5);
        assert_eq!(dv2["dividas"][1]["pagamentos"][0]["valor"], 312.45);
        // Desligar: tudo volta ao que era.
        let ef = editar(&mut m, &cats(), None, Some(None)).unwrap();
        assert_eq!(ef.desfazer_divida, Some(("d1".to_string(), antes)));
        aplicar(&ef, &mut m, &mut Value::Null, &mut Value::Null, &mut dv, "agora").unwrap();
        assert!(m.get("vinculo").is_none());
        let mut esperado = dividas_arq()["dividas"][0].clone();
        esperado["pagamentos"] = json!([]);
        assert_eq!(dv["dividas"][0], esperado);
        // Dívida quitada não recebe pagamento; nada é mexido.
        let mut dv = dividas_arq();
        dv["dividas"][0]["situacao"] = json!("quitada");
        let mut q = gasto();
        let ef = editar(&mut q, &cats(), None, vinculo("divida", "d1")).unwrap();
        assert_eq!(msg(aplicar(&ef, &mut q, &mut Value::Null, &mut Value::Null, &mut dv, "agora")), "essa dívida já está quitada");
        // Entrada não paga dívida; nada é mexido.
        let mut dv = dividas_arq();
        let mut e = gasto();
        e["valor"] = json!(95.0);
        e["natureza"] = json!("receita");
        let ef = editar(&mut e, &cats(), None, vinculo("divida", "d1")).unwrap();
        assert_eq!(msg(aplicar(&ef, &mut e, &mut Value::Null, &mut Value::Null, &mut dv, "agora")), "esse lançamento é uma entrada: só um gasto paga uma dívida");
        assert_eq!(dv, dividas_arq());
    }

    #[test]
    fn vinculo_antigo_de_divida_sem_efeito_nao_desfaz_nada() {
        // Ligado antes de o vínculo ter efeito (sem `divida_antes`): desligar não mexe na dívida.
        let mut m = gasto();
        m["vinculo"] = json!({ "tipo": "divida", "id": "d1" });
        let ef = editar(&mut m.clone(), &cats(), None, Some(None)).unwrap();
        assert_eq!(ef, Efeitos::default());
        let mut dv = dividas_arq();
        desfazer_vinculo(&m, &cats(), &[], &mut Value::Null, &mut Value::Null, &mut dv, "agora").unwrap();
        assert_eq!(dv, dividas_arq());
        // Religar à mesma dívida (sem pagamento registrado): agora paga.
        let ef = editar(&mut m, &cats(), None, vinculo("divida", "d1")).unwrap();
        assert_eq!((ef.pagar_divida.clone(), ef.desfazer_divida.clone()), (Some("d1".to_string()), None));
        aplicar(&ef, &mut m, &mut Value::Null, &mut Value::Null, &mut dv, "agora").unwrap();
        assert_eq!(dv["dividas"][0]["parcelas_restantes"], 4);
        assert!(m["vinculo"]["divida_antes"].is_object());
    }

    #[test]
    fn apagar_lancamento_ligado_a_divida_desfaz_o_pagamento() {
        let mut dv = dividas_arq();
        let mut m = gasto();
        let ef = editar(&mut m, &cats(), None, vinculo("divida", "d1")).unwrap();
        aplicar(&ef, &mut m, &mut Value::Null, &mut Value::Null, &mut dv, "agora").unwrap();
        desfazer_vinculo(&m, &cats(), &[], &mut Value::Null, &mut Value::Null, &mut dv, "agora").unwrap();
        assert_eq!(dv["dividas"][0]["parcelas_restantes"], 5);
        assert_eq!(dv["dividas"][0]["saldos"].as_array().unwrap().len(), 1);
        // Dívida apagada nesse meio-tempo: não impede.
        desfazer_vinculo(&m, &cats(), &[], &mut Value::Null, &mut Value::Null, &mut json!({ "dividas": [] }), "agora").unwrap();
    }

    #[test]
    fn pagamentos_de_dividas_de_lancamentos_que_sumiram() {
        let antes = json!({ "movimentacoes": [
            { "id": "a", "vinculo": { "tipo": "divida", "id": "d1", "divida_antes": { "parcelas_restantes": 3 } } },
            { "id": "b", "vinculo": { "tipo": "divida", "id": "d1", "divida_antes": { "parcelas_restantes": 2 } } },
            { "id": "c", "vinculo": { "tipo": "divida", "id": "d2" } },
            { "id": "p", "vinculo": { "tipo": "pessoa", "id": "e1" } }
        ]});
        let depois = json!({ "movimentacoes": [{ "id": "b" }] });
        assert_eq!(pagamentos_de_dividas_sumidos(&antes, &depois), vec![("d1".to_string(), "a".to_string(), json!({ "parcelas_restantes": 3 }))], "sem divida_antes não teve efeito");
    }

    #[test]
    fn partes_de_sem_partes_devolve_o_proprio() {
        let m = gasto();
        assert_eq!(partes_de(&m), vec![(-312.45, "a_classificar".to_string())]);
        let mut m = gasto();
        editar(&mut m, &cats(), Some(Some(vec![parte(-250.0, "p_comida"), parte(-62.45, "p_casa")])), None).unwrap();
        assert_eq!(partes_de(&m), vec![(-250.0, "p_comida".to_string()), (-62.45, "p_casa".to_string())]);
    }

    // ---------- Rodada 1 ----------

    fn emprestimos(direcao: &str) -> Value {
        json!({ "emprestimos": [{ "id": "e1", "pessoa": "Pessoa Exemplo", "direcao": direcao, "valor": 500.0, "data": "2026-10-01", "pagamentos": [] }] })
    }

    fn pagamentos(arq: &Value) -> Vec<Value> {
        arq["emprestimos"][0]["pagamentos"].as_array().cloned().unwrap_or_default()
    }

    #[test]
    fn mesma_descricao_nao_pega_lancamento_dividido() {
        let c = cats();
        let mut outro = gasto();
        outro["id"] = json!("m2");
        let desc = crate::importar::classificar::normalizar("MERCADO EXEMPLO");
        assert!(pega_mesma_descricao(&outro, &desc, &c, "p_comida"));
        assert!(!pega_mesma_descricao(&outro, &crate::importar::classificar::normalizar("OUTRA LOJA"), &c, "p_comida"));
        assert!(!pega_mesma_descricao(&outro, &desc, &c, "salario"), "tipo errado");
        // Dividido com uma parte pendente: categoria "a_classificar", mas não é tocado.
        editar(&mut outro, &c, Some(Some(vec![parte(-300.0, "p_comida"), parte(-12.45, "a_classificar")])), None).unwrap();
        assert_eq!(outro["categoria"], "a_classificar");
        assert!(!pega_mesma_descricao(&outro, &desc, &c, "p_comida"));
    }

    #[test]
    fn pagamento_tem_id_do_lancamento_e_nao_duplica() {
        let mut m = gasto();
        m["valor"] = json!(-95.0);
        let mut emp = emprestimos("eu_devo");
        let ef = editar(&mut m, &cats(), None, vinculo("pessoa", "e1")).unwrap();
        assert!(ef.precisa_emprestimos() && !ef.precisa_fixas());
        aplicar(&ef, &mut m, &mut Value::Null, &mut emp, &mut Value::Null, "agora").unwrap();
        assert_eq!(m["vinculo"]["pagamento_id"], "lanc-m1");
        let l = pagamentos(&emp);
        assert_eq!(l.len(), 1);
        assert_eq!((l[0]["id"].as_str(), l[0]["valor"].as_f64(), l[0]["obs"].as_str()), (Some("lanc-m1"), Some(95.0), Some("Lançamento MERCADO EXEMPLO")));
        // Aplicar de novo (repetição do pedido) não cria outro pagamento.
        aplicar(&ef, &mut m, &mut Value::Null, &mut emp, &mut Value::Null, "agora").unwrap();
        assert_eq!(pagamentos(&emp).len(), 1);
    }

    #[test]
    fn religar_a_mesma_pessoa_sem_pagamento_id_paga_de_novo() {
        let mut m = gasto();
        m["valor"] = json!(-95.0);
        m["vinculo"] = json!({ "tipo": "pessoa", "id": "e1" });
        let ef = editar(&mut m, &cats(), None, vinculo("pessoa", "e1")).unwrap();
        assert!(ef.pagar_pessoa.is_some() && ef.desfazer_pessoa.is_none());
        let mut emp = emprestimos("eu_devo");
        // Já existe o pagamento deste lançamento: reaproveita.
        emp["emprestimos"][0]["pagamentos"] = json!([{ "id": "lanc-m1", "data": "2026-10-30", "valor": 95.0 }]);
        aplicar(&ef, &mut m, &mut Value::Null, &mut emp, &mut Value::Null, "agora").unwrap();
        assert_eq!(pagamentos(&emp).len(), 1);
        assert_eq!(m["vinculo"]["pagamento_id"], "lanc-m1");
        // Com pagamento_id, ligar à mesma pessoa não faz nada.
        let ef = editar(&mut m, &cats(), None, vinculo("pessoa", "e1")).unwrap();
        assert_eq!(ef, Efeitos::default());
    }

    #[test]
    fn pessoa_so_no_sentido_certo() {
        let mut m = gasto();
        m["valor"] = json!(-95.0);
        let ef = editar(&mut m, &cats(), None, vinculo("pessoa", "e1")).unwrap();
        let mut emp = emprestimos("me_deve");
        assert_eq!(msg(aplicar(&ef, &mut m, &mut Value::Null, &mut emp, &mut Value::Null, "agora")), "esse lançamento é um gasto: só pode pagar algo que você deve a essa pessoa");
        assert!(pagamentos(&emp).is_empty());
        let mut r = gasto();
        r["valor"] = json!(95.0);
        r["natureza"] = json!("receita");
        let ef = editar(&mut r, &cats(), None, vinculo("pessoa", "e1")).unwrap();
        let mut emp = emprestimos("eu_devo");
        assert_eq!(msg(aplicar(&ef, &mut r, &mut Value::Null, &mut emp, &mut Value::Null, "agora")), "esse lançamento é uma entrada: só pode receber de quem te deve");
        let mut emp = emprestimos("me_deve");
        aplicar(&ef, &mut r, &mut Value::Null, &mut emp, &mut Value::Null, "agora").unwrap();
        assert_eq!(pagamentos(&emp).len(), 1);
    }

    #[test]
    fn fixa_ja_paga_nao_e_desmarcada() {
        let mut fixas = json!({ "fixas": [{ "id": "f1", "pagos": ["2026-11"] }, { "id": "f2", "pagos": [] }] });
        let mut m = gasto();
        let ef = editar(&mut m, &cats(), None, vinculo("fixa", "f1")).unwrap();
        aplicar(&ef, &mut m, &mut fixas, &mut Value::Null, &mut Value::Null, "agora").unwrap();
        assert_eq!(m["vinculo"], json!({ "tipo": "fixa", "id": "f1", "mes": "2026-11", "ja_paga": true }));
        // Desligar não desmarca o que já estava pago antes.
        let mut d = m.clone();
        let ef = editar(&mut d, &cats(), None, Some(None)).unwrap();
        assert_eq!(ef, Efeitos::default());
        // Trocar para f2: f1 fica como estava, f2 é marcada (e desmarcada ao desligar).
        let ef = editar(&mut m, &cats(), None, vinculo("fixa", "f2")).unwrap();
        assert!(ef.fixa_anterior.is_none());
        aplicar(&ef, &mut m, &mut fixas, &mut Value::Null, &mut Value::Null, "agora").unwrap();
        assert_eq!(m["vinculo"], json!({ "tipo": "fixa", "id": "f2", "mes": "2026-11" }));
        assert_eq!(fixas["fixas"][0]["pagos"], json!(["2026-11"]));
        assert_eq!(fixas["fixas"][1]["pagos"], json!(["2026-11"]));
        let ef = editar(&mut m, &cats(), None, Some(None)).unwrap();
        aplicar(&ef, &mut m, &mut fixas, &mut Value::Null, &mut Value::Null, "agora").unwrap();
        assert_eq!(fixas["fixas"][1]["pagos"], json!([]));
    }

    #[test]
    fn desfazer_o_que_sumiu_nao_impede() {
        let mut m = gasto();
        m["vinculo"] = json!({ "tipo": "pessoa", "id": "e1", "pagamento_id": "lanc-m1" });
        let ef = editar(&mut m, &cats(), None, Some(None)).unwrap();
        aplicar(&ef, &mut m, &mut Value::Null, &mut emprestimos("eu_devo"), &mut Value::Null, "agora").unwrap();
        let mut f = gasto();
        f["vinculo"] = json!({ "tipo": "fixa", "id": "apagada" });
        let ef = editar(&mut f, &cats(), None, Some(None)).unwrap();
        aplicar(&ef, &mut f, &mut json!({ "fixas": [] }), &mut Value::Null, &mut Value::Null, "agora").unwrap();
        // Mas ligar a algo que não existe é erro.
        let ef = editar(&mut f, &cats(), None, vinculo("fixa", "nao-existe")).unwrap();
        assert!(matches!(aplicar(&ef, &mut f, &mut json!({ "fixas": [] }), &mut Value::Null, &mut Value::Null, "agora"), Err(Falha::NaoEncontrado(_))));
    }

    #[test]
    fn apagar_lancamento_ligado_desfaz() {
        let mut emp = emprestimos("eu_devo");
        let mut m = gasto();
        m["valor"] = json!(-95.0);
        let ef = editar(&mut m, &cats(), None, vinculo("pessoa", "e1")).unwrap();
        aplicar(&ef, &mut m, &mut Value::Null, &mut emp, &mut Value::Null, "agora").unwrap();
        assert_eq!(pagamentos(&emp).len(), 1);
        desfazer_vinculo(&m, &cats(), &[], &mut Value::Null, &mut emp, &mut Value::Null, "agora").unwrap();
        assert!(pagamentos(&emp).is_empty());
        // Fixa já paga antes de ligar continua paga.
        let mut fixas = json!({ "fixas": [{ "id": "f1", "pagos": ["2026-11"] }] });
        let mut f = gasto();
        f["vinculo"] = json!({ "tipo": "fixa", "id": "f1", "ja_paga": true });
        desfazer_vinculo(&f, &cats(), &[], &mut fixas, &mut Value::Null, &mut Value::Null, "agora").unwrap();
        assert_eq!(fixas["fixas"][0]["pagos"], json!(["2026-11"]));
        f["vinculo"] = json!({ "tipo": "fixa", "id": "f1" });
        desfazer_vinculo(&f, &cats(), &[], &mut fixas, &mut Value::Null, &mut Value::Null, "agora").unwrap();
        assert_eq!(fixas["fixas"][0]["pagos"], json!([]));
    }

    #[test]
    fn divida_precisa_existir() {
        let dv = json!({ "dividas": [{ "id": "informada-carro-abc" }] });
        assert!(conferir_divida(&dv, "informada-carro-abc").is_ok());
        assert_eq!(msg(conferir_divida(&dv, "outra")), "dívida não encontrada");
        assert_eq!(msg(conferir_divida(&Value::Null, "outra")), "dívida não encontrada");
    }

    // ---------- Revisão final ----------

    #[test]
    fn detalhe_escrito_normaliza_e_limita() {
        assert_eq!(detalhe_escrito("  Luz   e  água ").unwrap(), json!("Luz e água"));
        assert_eq!(detalhe_escrito("   ").unwrap(), Value::Null, "vazio limpa");
        assert_eq!(detalhe_escrito(&"a".repeat(40)).unwrap(), json!("a".repeat(40)));
        assert_eq!(msg(detalhe_escrito(&"á".repeat(41))), "o detalhe pode ter até 40 letras");
    }

    fn lista_mercado() -> Vec<Value> {
        let mut m2 = gasto();
        m2["id"] = json!("m2");
        m2["subcategoria"] = json!("velho");
        let mut m3 = gasto();
        m3["id"] = json!("m3");
        m3["descricao"] = json!("OUTRA LOJA");
        vec![gasto(), m2, m3]
    }

    #[test]
    fn categoria_com_detalhe_vale_tambem_para_mesma_descricao() {
        let c = cats();
        let mut l = lista_mercado();
        let alterados = aplicar_categoria(&mut l, "m1", &c, "p_casa", &json!("Luz"), true);
        assert_eq!(alterados, vec![json!("m1"), json!("m2")]);
        for m in &l[..2] {
            assert_eq!((m["categoria"].as_str(), m["subcategoria"].as_str(), m["classificacao"].as_str()), (Some("p_casa"), Some("Luz"), Some("manual")));
        }
        assert_eq!(l[2], lista_mercado()[2], "outra descrição não muda");
        // Sem marcar "mesma descrição": só este.
        let mut l = lista_mercado();
        assert_eq!(aplicar_categoria(&mut l, "m1", &c, "p_casa", &json!("Luz"), false), vec![json!("m1")]);
        assert_eq!(l[1]["categoria"], "a_classificar");
        // Sem detalhe: limpa (inclusive o do outro de mesma descrição).
        let mut l = lista_mercado();
        l[0]["subcategoria"] = json!("Luz");
        aplicar_categoria(&mut l, "m1", &c, "p_comida", &Value::Null, true);
        assert_eq!((l[0]["subcategoria"].clone(), l[1]["subcategoria"].clone()), (Value::Null, Value::Null));
    }

    #[test]
    fn detalhe_da_parte_ate_40_letras() {
        let c = cats();
        let longa = json!({ "valor": -62.45, "categoria": "p_casa", "subcategoria": "x".repeat(41) });
        assert_eq!(msg(validar_partes(&c, "despesa", -312.45, &[parte(-250.0, "p_comida"), longa], &[])), "o detalhe pode ter até 40 letras");
        let ok = json!({ "valor": -62.45, "categoria": "p_casa", "subcategoria": "x".repeat(40) });
        assert!(validar_partes(&c, "despesa", -312.45, &[parte(-250.0, "p_comida"), ok], &[]).is_ok());
    }

    #[test]
    fn reeditar_partes_preserva_detalhe_antigo() {
        let c = cats();
        let mut m = gasto();
        m["partes"] = json!([
            { "valor": -250.0, "categoria": "p_comida" },
            { "valor": -62.45, "categoria": "p_casa", "subcategoria": "Carro", "detalhe_antigo": "Pneu" }
        ]);
        // Mesma categoria e mesmo detalhe (valor diferente, ordem trocada): continua guardado.
        let p = vec![json!({ "valor": -100.0, "categoria": "p_casa", "subcategoria": " Carro " }), parte(-212.45, "p_comida")];
        editar(&mut m, &c, Some(Some(p)), None).unwrap();
        assert_eq!(m["partes"], json!([
            { "valor": -100.0, "categoria": "p_casa", "subcategoria": "Carro", "detalhe_antigo": "Pneu" },
            { "valor": -212.45, "categoria": "p_comida" }
        ]));
        // Detalhe trocado: o antigo não passa para a parte nova.
        let p = vec![json!({ "valor": -100.0, "categoria": "p_casa", "subcategoria": "Moto" }), parte(-212.45, "p_comida")];
        editar(&mut m, &c, Some(Some(p)), None).unwrap();
        assert!(m["partes"][0].get("detalhe_antigo").is_none());
        // O que vier no pedido não vale: só o que já estava guardado.
        let p = vec![json!({ "valor": -100.0, "categoria": "p_casa", "detalhe_antigo": "inventado" }), parte(-212.45, "p_comida")];
        editar(&mut m, &c, Some(Some(p)), None).unwrap();
        assert!(m["partes"][0].get("detalhe_antigo").is_none());
    }

    #[test]
    fn fixa_guarda_o_mes_e_desfaz_nele() {
        let mut m = gasto();
        editar(&mut m, &cats(), None, vinculo("fixa", "f1")).unwrap();
        assert_eq!(m["vinculo"], json!({ "tipo": "fixa", "id": "f1", "mes": "2026-11" }));
        // A competência mudou depois de ligar: desfaz no mês em que ligou.
        m["competencia"] = json!("2026-12");
        let ef = editar(&mut m.clone(), &cats(), None, Some(None)).unwrap();
        assert_eq!(ef.fixa, Some(("f1".to_string(), "2026-11".to_string(), false)));
        let ef = editar(&mut m, &cats(), None, vinculo("fixa", "f2")).unwrap();
        assert_eq!(ef.fixa_anterior, Some(("f1".to_string(), "2026-11".to_string(), false)));
        assert_eq!(ef.fixa, Some(("f2".to_string(), "2026-12".to_string(), true)));
        // Vínculo antigo, sem mês guardado: o da competência.
        let mut v = gasto();
        v["vinculo"] = json!({ "tipo": "fixa", "id": "f1" });
        let ef = editar(&mut v, &cats(), None, Some(None)).unwrap();
        assert_eq!(ef.fixa, Some(("f1".to_string(), "2026-11".to_string(), false)));
    }

    #[test]
    fn fixa_ligada_a_outro_lancamento_do_mes_nao_e_desmarcada() {
        let mut m = gasto();
        m["vinculo"] = json!({ "tipo": "fixa", "id": "f1", "mes": "2026-11" });
        let mut outro = gasto();
        outro["id"] = json!("m2");
        outro["vinculo"] = json!({ "tipo": "fixa", "id": "f1", "mes": "2026-11" });
        let mut de_outro_mes = outro.clone();
        de_outro_mes["vinculo"]["mes"] = json!("2026-10");
        // Só o próprio lançamento ou outro mês: desmarca.
        let mut ef = editar(&mut m.clone(), &cats(), None, Some(None)).unwrap();
        ef.manter_fixas_ainda_ligadas(&[m.clone(), de_outro_mes.clone()], "m1");
        assert_eq!(ef.fixa, Some(("f1".to_string(), "2026-11".to_string(), false)));
        // Outro lançamento ainda ligado à mesma fixa no mesmo mês: não desmarca.
        let mut ef = editar(&mut m.clone(), &cats(), None, Some(None)).unwrap();
        ef.manter_fixas_ainda_ligadas(&[m.clone(), outro.clone()], "m1");
        assert_eq!(ef.fixa, None);
        // Trocar de fixa: a antiga fica marcada, a nova é marcada.
        let mut ef = editar(&mut m.clone(), &cats(), None, vinculo("fixa", "f2")).unwrap();
        ef.manter_fixas_ainda_ligadas(&[m.clone(), outro.clone()], "m1");
        assert_eq!((ef.fixa_anterior, ef.fixa), (None, Some(("f2".to_string(), "2026-11".to_string(), true))));
        // Apagar o lançamento: idem.
        let mut fixas = json!({ "fixas": [{ "id": "f1", "pagos": ["2026-11"] }] });
        desfazer_vinculo(&m, &cats(), &[outro], &mut fixas, &mut Value::Null, &mut Value::Null, "agora").unwrap();
        assert_eq!(fixas["fixas"][0]["pagos"], json!(["2026-11"]));
        desfazer_vinculo(&m, &cats(), &[de_outro_mes], &mut fixas, &mut Value::Null, &mut Value::Null, "agora").unwrap();
        assert_eq!(fixas["fixas"][0]["pagos"], json!([]));
    }

    #[test]
    fn pagamentos_de_lancamentos_que_sumiram() {
        let antes = json!({ "movimentacoes": [
            { "id": "a", "vinculo": { "tipo": "pessoa", "id": "e1", "pagamento_id": "lanc-a" } },
            { "id": "b", "vinculo": { "tipo": "pessoa", "id": "e2", "pagamento_id": "lanc-b" } },
            { "id": "c", "vinculo": { "tipo": "fixa", "id": "f1" } },
            { "id": "d" }
        ]});
        let depois = json!({ "movimentacoes": [{ "id": "b" }] });
        assert_eq!(pagamentos_sumidos(&antes, &depois), vec![("e1".to_string(), "lanc-a".to_string())]);
    }
}
