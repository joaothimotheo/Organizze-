//! Contas fixas (`fixas.json` → `fixas[]`): assinaturas e contas que se repetem todo mês,
//! inclusive as pagas por fora do banco sincronizado (Pix, dinheiro, boleto).

use crate::emprestimos::Falha;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

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

// ---- Regras de pagamento e sugestões: porte de `frontend/src/fixas.ts` e `gastos.ts`. ----
// Os casos em `frontend/testes/casos/fixas.json` rodam nas duas pontas, para não divergirem.

/// Sem acentos, maiúsculas e espaços únicos: a mesma normalização do front para comparar textos.
fn norm(s: &str) -> String {
    let sem_acento: String = s.nfd().filter(|c| !('\u{300}'..='\u{36f}').contains(c)).collect();
    sem_acento.to_uppercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn texto<'a>(v: &'a Value, campo: &str) -> &'a str {
    v[campo].as_str().unwrap_or("")
}

/// Mês em que o lançamento conta: a competência, senão o mês da data.
pub fn competencia(m: &Value) -> String {
    match m["competencia"].as_str() {
        Some(c) => c.to_string(),
        None => texto(m, "data").chars().take(7).collect(),
    }
}

/// "UBER *TRIP 12/03" → "UBER TRIP": junta compras do mesmo lugar.
pub fn lugar(descricao: &str) -> String {
    // `\b` e dígitos só ASCII, como no JavaScript do front.
    static PARCELA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?-u:\b)(PARC(ELA)?\s*)?[0-9]{1,2}\s*/\s*[0-9]{1,2}(?-u:\b)").unwrap());
    static SIMBOLOS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[*\-_.]").unwrap());
    static NUMEROS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?-u:\b)[0-9]+(?-u:\b)").unwrap());
    let t = descricao.to_uppercase();
    let t = PARCELA.replace_all(&t, " ");
    let t = SIMBOLOS.replace_all(&t, " ");
    let t = NUMEROS.replace_all(&t, " ");
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() {
        descricao.trim().to_string()
    } else {
        t
    }
}

/// "DL GOOGLE YOUTUB" → "Youtub"; "EBN SPOTIFY" → "Spotify": tira os prefixos de intermediadores de pagamento.
pub fn nome_limpo(chave: &str) -> String {
    static PREFIXOS: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^(?:(?:DL|DM|EBN|PG|PAG|PAGSEGURO|MP|MERCADOPAGO|PAYPAL|IFD|IFOOD|EC|HTM|APPLE COM BILL)\s+)+(GOOGLE\s+)?").unwrap());
    // "GOOGLE" só sai quando ainda sobra algo depois dele (no front, `(?=\S)`).
    let inicio = match PREFIXOS.captures(chave) {
        Some(c) => match c.get(1) {
            Some(g) if !chave[g.end()..].trim().is_empty() => g.end(),
            Some(g) => g.start(),
            None => c.get(0).map_or(0, |m| m.end()),
        },
        None => 0,
    };
    let resto = &chave[inicio..];
    let t = resto.trim();
    let t = if t.is_empty() { chave } else { t };
    let mut cs = t.chars();
    match cs.next() {
        Some(p) => p.to_string() + &cs.as_str().to_lowercase(),
        None => String::new(),
    }
}

fn busca_da(f: &Value) -> String {
    norm(texto(f, "busca"))
}

/// O lançamento do banco que paga esta conta no mês (pelo texto de busca), se houver.
fn pagamento_no_banco<'a>(f: &Value, movs: &'a [Value], mes: &str) -> Option<&'a Value> {
    let b = busca_da(f);
    if b.is_empty() {
        return None;
    }
    movs.iter().find(|m| {
        m["valor"].as_f64().is_some_and(|v| v < 0.0) && competencia(m) == mes && (norm(texto(m, "descricao")).contains(&b) || norm(texto(m, "nome")).contains(&b))
    })
}

/// Um lançamento ligado a esta conta (`vinculo`) que paga o mês: o guardado ao ligar
/// (`vinculo.mes`) ou, sem ele, a competência do lançamento.
fn ligado_a_fixa(f: &Value, m: &Value, mes: &str) -> bool {
    m["vinculo"]["tipo"] == "fixa" && !texto(f, "id").is_empty() && m["vinculo"]["id"].as_str() == Some(texto(f, "id")) && crate::lancamentos::mes_da_fixa(m) == mes
}

/// A conta está paga no mês ("2026-11"): marcada à mão, achada no banco ou com um lançamento ligado a ela.
pub fn paga_no_mes(f: &Value, movs: &[Value], mes: &str) -> bool {
    f["pagos"].as_array().is_some_and(|p| p.iter().any(|x| x.as_str() == Some(mes))) || pagamento_no_banco(f, movs, mes).is_some() || movs.iter().any(|m| ligado_a_fixa(f, m, mes))
}

#[derive(Debug, Serialize)]
pub struct Sugestao {
    pub chave: String,
    pub nome: String,
    pub valor: f64,
    pub dia: u32,
    /// Data da última cobrança ("2026-11-07").
    pub ultima: String,
}

/// "2026-11" mais `n` meses (negativo volta).
fn add_mes(comp: &str, n: i32) -> String {
    let mut p = comp.split('-').map(|x| x.parse::<i32>().unwrap_or(0));
    let (a, m) = (p.next().unwrap_or(0), p.next().unwrap_or(1) + n);
    format!("{}-{:02}", a + (m - 1).div_euclid(12), (m - 1).rem_euclid(12) + 1)
}

/// Cobranças do banco que parecem contas fixas e ainda não estão cadastradas: tudo da categoria
/// Assinaturas, ou o mesmo lugar cobrado em pelo menos 3 dos últimos 4 meses com valor parecido
/// (até 10% de diferença). Fica de fora o que parou de ser cobrado (nada no mês atual nem no
/// anterior) e o que foi mandado ignorar. Mesma regra de `sugestoes` no front.
pub fn sugestoes(movs: &[Value], fixas: &[Value], mes_atual: &str, ignoradas: &[String], categorias: &[Value]) -> Vec<Sugestao> {
    let ids_assinaturas: HashSet<&str> = categorias.iter().filter(|g| norm(texto(g, "nome")) == "ASSINATURAS").map(|g| texto(g, "id")).collect();
    let recentes = [mes_atual.to_string(), add_mes(mes_atual, -1)];
    let janela: Vec<String> = (0..4).map(|i| add_mes(mes_atual, -i)).collect();
    // Grupos na ordem em que aparecem (o desempate da ordenação final depende dela).
    let mut ordem: Vec<(String, Vec<&Value>)> = Vec::new();
    let mut posicao: HashMap<String, usize> = HashMap::new();
    for m in movs {
        let despesa = m["valor"].as_f64().is_some_and(|v| v < 0.0) && texto(m, "natureza") == "despesa";
        let com_parcela = !matches!(m["parcela"], Value::Null | Value::Bool(false));
        if !despesa || com_parcela || !janela.contains(&competencia(m)) {
            continue;
        }
        let k = lugar(texto(m, "descricao"));
        let i = *posicao.entry(k.clone()).or_insert_with(|| {
            ordem.push((k, Vec::new()));
            ordem.len() - 1
        });
        ordem[i].1.push(m);
    }
    let buscas: Vec<String> = fixas.iter().map(busca_da).filter(|b| !b.is_empty()).collect();
    let mut saida: Vec<(usize, Sugestao)> = Vec::new();
    for (k, l) in &ordem {
        let nk = norm(k);
        if ignoradas.contains(k) || buscas.iter().any(|b| nk.contains(b.as_str()) || b.contains(&nk)) {
            continue;
        }
        if !l.iter().any(|m| recentes.contains(&competencia(m))) {
            continue;
        }
        let meses = l.iter().map(|m| competencia(m)).collect::<HashSet<_>>().len();
        let valores: Vec<f64> = l.iter().map(|m| -m["valor"].as_f64().unwrap_or(0.0)).collect();
        let max = valores.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let min = valores.iter().cloned().fold(f64::INFINITY, f64::min);
        let assinatura = l.iter().any(|m| texto(m, "categoria") == "assinaturas" || ids_assinaturas.contains(texto(m, "categoria")) || texto(m, "recorrencia") == "fixa");
        let repetida = meses >= 3 && l.len() <= meses + 1 && min >= max * 0.9;
        if !assinatura && !repetida {
            continue;
        }
        // A cobrança mais recente; em empate de data, a que veio primeiro.
        let ultimo = l.iter().fold(l[0], |a, m| if texto(m, "data") > texto(a, "data") { m } else { a });
        let data = texto(ultimo, "data");
        saida.push((
            meses,
            Sugestao {
                chave: k.clone(),
                nome: nome_limpo(k),
                valor: r2(-ultimo["valor"].as_f64().unwrap_or(0.0)),
                dia: data.get(8..10).and_then(|d| d.parse().ok()).filter(|&d| d != 0).unwrap_or(1),
                ultima: data.to_string(),
            },
        ));
    }
    saida.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.valor.total_cmp(&a.1.valor)));
    saida.into_iter().map(|(_, s)| s).collect()
}

#[cfg(test)]
mod testes {
    use super::*;

    fn fixa(nome: &str, valor: f64, forma: &str) -> NovaFixa {
        NovaFixa { nome: nome.into(), valor, dia: Some(10), forma: forma.into(), categoria: None, busca: Some("  ".into()), ativa: true }
    }

    const CASOS: &str = include_str!("../../frontend/testes/casos/fixas.json");

    fn casos() -> Value {
        serde_json::from_str(CASOS).unwrap()
    }

    fn textos(v: &Value) -> Vec<String> {
        v.as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect()
    }

    #[test]
    fn lugar_igual_ao_front() {
        let c = casos();
        for caso in c["lugar"].as_array().unwrap() {
            assert_eq!(lugar(caso["entrada"].as_str().unwrap()), caso["saida"].as_str().unwrap(), "lugar {}", caso["entrada"]);
        }
    }

    #[test]
    fn nome_limpo_igual_ao_front() {
        let c = casos();
        for caso in c["nome_limpo"].as_array().unwrap() {
            assert_eq!(nome_limpo(caso["entrada"].as_str().unwrap()), caso["saida"].as_str().unwrap(), "nome_limpo {}", caso["entrada"]);
        }
    }

    #[test]
    fn sugestoes_iguais_ao_front() {
        let c = casos();
        for caso in c["sugestoes"].as_array().unwrap() {
            let movs = caso["movs"].as_array().unwrap();
            let fixas = caso["fixas"].as_array().unwrap();
            let categorias = caso["categorias"].as_array().unwrap();
            let r = sugestoes(movs, fixas, caso["mes_atual"].as_str().unwrap(), &textos(&caso["ignoradas"]), categorias);
            let chaves: Vec<String> = r.into_iter().map(|s| s.chave).collect();
            assert_eq!(chaves, textos(&caso["chaves_esperadas"]), "{}", caso["nome"]);
        }
    }

    #[test]
    fn sugestao_traz_valor_dia_e_ultima_cobranca() {
        let movs = vec![
            json!({ "data": "2026-10-07", "descricao": "SPOTIFY AB", "valor": -21.9, "natureza": "despesa", "categoria": "assinaturas" }),
            json!({ "data": "2026-11-09", "descricao": "EBN SPOTIFY AB", "valor": -23.9, "natureza": "despesa", "categoria": "assinaturas" }),
        ];
        let s = sugestoes(&movs, &[], "2026-11", &[], &[]);
        assert_eq!(s.len(), 2);
        let ebn = s.iter().find(|x| x.chave == "EBN SPOTIFY AB").unwrap();
        assert_eq!((ebn.nome.as_str(), ebn.valor, ebn.dia, ebn.ultima.as_str()), ("Spotify ab", 23.9, 9, "2026-11-09"));
    }

    #[test]
    fn paga_no_mes_por_lancamento_ligado() {
        let f = json!({ "id": "f1", "ativa": true, "busca": "", "pagos": [] });
        let ligado = json!({ "valor": -50.0, "competencia": "2026-11", "vinculo": { "tipo": "fixa", "id": "f1" } });
        assert!(paga_no_mes(&f, &[ligado.clone()], "2026-11"));
        assert!(!paga_no_mes(&f, &[ligado], "2026-12"));
        // `vinculo.mes` vale mais que a competência.
        let com_mes = json!({ "valor": -50.0, "competencia": "2026-12", "vinculo": { "tipo": "fixa", "id": "f1", "mes": "2026-11" } });
        assert!(paga_no_mes(&f, &[com_mes.clone()], "2026-11"));
        assert!(!paga_no_mes(&f, &[com_mes], "2026-12"));
        // Outra conta ou outro tipo de vínculo não conta.
        let outra = json!({ "valor": -50.0, "competencia": "2026-11", "vinculo": { "tipo": "fixa", "id": "f2" } });
        let divida = json!({ "valor": -50.0, "competencia": "2026-11", "vinculo": { "tipo": "divida", "id": "f1" } });
        assert!(!paga_no_mes(&f, &[outra, divida], "2026-11"));
    }

    #[test]
    fn paga_no_mes_por_marcacao_e_por_banco() {
        let marcada = json!({ "ativa": true, "pagos": ["2026-11"] });
        assert!(paga_no_mes(&marcada, &[], "2026-11"));
        assert!(!paga_no_mes(&marcada, &[], "2026-12"));

        let por_banco = json!({ "ativa": true, "busca": "NETFLIX", "pagos": [] });
        let movs = vec![json!({ "data": "2026-11-05", "descricao": "Netflix.com", "valor": -55.9, "natureza": "despesa", "competencia": "2026-11" })];
        assert!(paga_no_mes(&por_banco, &movs, "2026-11"));
        assert!(!paga_no_mes(&por_banco, &movs, "2026-10"));
        // Entrada com o mesmo texto não paga a conta; sem texto de busca só vale a marcação.
        let entrada = vec![json!({ "data": "2026-11-05", "descricao": "NETFLIX estorno", "valor": 55.9, "natureza": "estorno" })];
        assert!(!paga_no_mes(&por_banco, &entrada, "2026-11"));
        assert!(!paga_no_mes(&json!({ "ativa": true, "busca": null }), &movs, "2026-11"));
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
