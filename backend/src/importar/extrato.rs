//! Extrato de conta corrente em OFX (padrão dos bancos) ou CSV.

use anyhow::{bail, Result};
use regex::Regex;
use serde_json::{json, Value};

use super::classificar::Classificador;
use super::fatura_santander::{fmt_data, nome_mes};
use super::{brl, data_br, hash_mov, r2, Extraido};
use crate::pdf::valor_br;

#[derive(Debug, Clone, PartialEq)]
pub struct Lanc {
    pub data: String,
    pub descricao: String,
    pub valor: f64,
    pub id_banco: Option<String>,
}

#[derive(Debug, Default)]
pub struct Lido {
    pub banco: Option<String>,
    pub final_conta: Option<String>,
    pub lancamentos: Vec<Lanc>,
    pub saldo_final: Option<(String, f64)>,
}

fn texto(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        // Muitos bancos ainda exportam em Latin-1 (Windows-1252).
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

fn data_ofx(s: &str) -> Option<String> {
    let d = s.get(..8)?;
    chrono::NaiveDate::parse_from_str(d, "%Y%m%d").ok().map(|x| x.format("%Y-%m-%d").to_string())
}

fn valor_ofx(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.contains(',') && !s.contains('.') {
        s.replace(',', ".").parse().ok()
    } else {
        s.parse().ok().or_else(|| valor_br(s))
    }
}

/// Valor de uma tag OFX (SGML sem fechamento ou XML).
fn tag(bloco: &str, nome: &str) -> Option<String> {
    let rx = Regex::new(&format!(r"(?is)<{nome}>([^<\r\n]*)")).unwrap();
    rx.captures(bloco).map(|c| c[1].trim().to_string()).filter(|s| !s.is_empty())
}

pub fn ler_ofx(t: &str) -> Result<Lido> {
    let mut l = Lido { banco: tag(t, "BANKID").or_else(|| tag(t, "ORG")), ..Default::default() };
    l.final_conta = tag(t, "ACCTID").map(|a| {
        let dig: String = a.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        dig.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect()
    });
    // Em OFX SGML as tags não fecham; cada bloco vai até o próximo <STMTTRN>.
    for p in t.split("<STMTTRN>").skip(1) {
        let bloco = p.split("</STMTTRN>").next().unwrap_or(p);
        let (Some(data), Some(valor)) = (tag(bloco, "DTPOSTED").and_then(|d| data_ofx(&d)), tag(bloco, "TRNAMT").and_then(|v| valor_ofx(&v))) else {
            continue;
        };
        let memo = tag(bloco, "MEMO");
        let nome = tag(bloco, "NAME");
        let descricao = match (nome, memo) {
            (Some(n), Some(m)) if n != m => format!("{n} {m}"),
            (Some(n), _) => n,
            (None, Some(m)) => m,
            _ => String::new(),
        };
        l.lancamentos.push(Lanc { data, descricao: descricao.split_whitespace().collect::<Vec<_>>().join(" "), valor: r2(valor), id_banco: tag(bloco, "FITID") });
    }
    if let Some(bal) = t.to_uppercase().find("<LEDGERBAL>").map(|i| &t[i..]) {
        if let (Some(v), Some(d)) = (tag(bal, "BALAMT").and_then(|v| valor_ofx(&v)), tag(bal, "DTASOF").and_then(|d| data_ofx(&d))) {
            l.saldo_final = Some((d, r2(v)));
        }
    }
    Ok(l)
}

fn separar_csv(linha: &str, sep: char) -> Vec<String> {
    let mut out = Vec::new();
    let mut atual = String::new();
    let mut aspas = false;
    let mut chars = linha.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if aspas && chars.peek() == Some(&'"') => {
                atual.push('"');
                chars.next();
            }
            '"' => aspas = !aspas,
            c if c == sep && !aspas => out.push(std::mem::take(&mut atual).trim().to_string()),
            c => atual.push(c),
        }
    }
    out.push(atual.trim().to_string());
    out
}

fn valor_csv(s: &str) -> Option<f64> {
    let s = s.trim().trim_start_matches("R$").trim().replace(' ', "");
    if s.is_empty() {
        return None;
    }
    let neg_parenteses = s.starts_with('(') && s.ends_with(')');
    let s = s.trim_matches(|c| c == '(' || c == ')');
    let (s, neg_final) = match s.strip_suffix('-').or_else(|| s.strip_suffix('D')) {
        Some(r) => (r.to_string(), true),
        None => (s.trim_end_matches('C').to_string(), false),
    };
    let v = valor_br(&s).or_else(|| {
        // "1234,56" sem separador de milhar, ou "1234.56"
        if s.contains(',') {
            s.replace('.', "").replace(',', ".").parse().ok()
        } else {
            s.parse().ok()
        }
    })?;
    Some(if neg_parenteses || neg_final { -v.abs() } else { v })
}

/// CSV com cabeçalho. Procura colunas de data, descrição e valor (ou crédito e débito).
pub fn ler_csv(t: &str) -> Result<Lido> {
    let linhas: Vec<&str> = t.lines().filter(|l| !l.trim().is_empty()).collect();
    let sep = if linhas.iter().take(15).map(|l| l.matches(';').count()).sum::<usize>() > 0 { ';' } else { ',' };
    let norm = |s: &str| s.to_lowercase().replace(['á', 'à', 'ã', 'â'], "a").replace(['é', 'ê'], "e").replace('í', "i").replace(['ó', 'õ', 'ô'], "o").replace(['ú'], "u").replace('ç', "c");
    let mut cab = None;
    for (i, l) in linhas.iter().enumerate().take(30) {
        let cols: Vec<String> = separar_csv(l, sep).iter().map(|c| norm(c)).collect();
        let pos = |f: &dyn Fn(&str) -> bool| cols.iter().position(|c| f(c));
        let data = pos(&|c| c.starts_with("data"));
        let desc = pos(&|c| c.contains("descri") || c.contains("historico") || c.contains("lancamento") || c.contains("estabelecimento"));
        let valor = pos(&|c| c.starts_with("valor") || c == "montante" || c.contains("valor (r$)"));
        let cred = pos(&|c| c.contains("credito") || c.contains("entrada"));
        let deb = pos(&|c| c.contains("debito") || c.contains("saida"));
        let saldo = pos(&|c| c.starts_with("saldo"));
        if let (Some(d), Some(ds)) = (data, desc) {
            if valor.is_some() || (cred.is_some() && deb.is_some()) {
                cab = Some((i, d, ds, valor, cred, deb, saldo));
                break;
            }
        }
    }
    let Some((ini, cd, cds, cv, cc, cdb, cs)) = cab else {
        bail!("não reconheci as colunas do CSV; preciso de Data, Descrição/Histórico e Valor (ou Crédito e Débito)")
    };
    let mut l = Lido::default();
    for linha in &linhas[ini + 1..] {
        let cols = separar_csv(linha, sep);
        let get = |i: usize| cols.get(i).map(String::as_str).unwrap_or("");
        let Some(data) = data_br(get(cd)).or_else(|| chrono::NaiveDate::parse_from_str(get(cd), "%Y-%m-%d").ok().map(|d| d.to_string())) else {
            continue;
        };
        let descricao = get(cds).split_whitespace().collect::<Vec<_>>().join(" ");
        if descricao.to_uppercase().starts_with("SALDO") {
            if let Some(v) = cv.and_then(|i| valor_csv(get(i))).or_else(|| cs.and_then(|i| valor_csv(get(i)))) {
                l.saldo_final = Some((data, r2(v)));
            }
            continue;
        }
        let valor = match cv {
            Some(i) => valor_csv(get(i)),
            None => {
                let c = cc.and_then(|i| valor_csv(get(i))).map(f64::abs);
                let d = cdb.and_then(|i| valor_csv(get(i))).map(|v| -v.abs());
                match (c, d) {
                    (Some(c), _) if c != 0.0 => Some(c),
                    (_, Some(d)) => Some(d),
                    (c, None) => c,
                }
            }
        };
        let Some(valor) = valor else { continue };
        if let Some(i) = cs {
            if let Some(s) = valor_csv(get(i)) {
                l.saldo_final = Some((data.clone(), r2(s)));
            }
        }
        l.lancamentos.push(Lanc { data, descricao, valor: r2(valor), id_banco: None });
    }
    if l.lancamentos.is_empty() {
        bail!("o CSV não tem lançamentos com data e valor reconhecíveis");
    }
    Ok(l)
}

/// Natureza e categoria de um lançamento de conta corrente.
fn natureza(desc: &str, valor: f64, regras: &Classificador) -> (&'static str, String, Option<String>, String) {
    let u = desc.to_uppercase();
    let rx = |p: &str| Regex::new(p).unwrap().is_match(&u);
    if rx(r"PAGAMENTO (DE )?(FATURA|CART)|PAGTO CART|FATURA CART|PAG(TO)? FAT") {
        return ("transferencia_interna", "pagamento_fatura_cartao".into(), None, "alta".into());
    }
    if rx(r"APLICA[CÇ][AÃ]O|APLIC\.?|INVEST") && valor < 0.0 {
        return ("aporte_investimento", "investimentos".into(), None, "media".into());
    }
    if rx(r"RESGATE|RESG\.?") && valor > 0.0 {
        return ("resgate_investimento", "investimentos".into(), None, "media".into());
    }
    if valor > 0.0 {
        if rx(r"SALARIO|SALÁRIO|PROVENTO|FOLHA|PAGTO SAL|PAG SAL|REMUNERA") {
            return ("receita", "salario".into(), None, "alta".into());
        }
        if rx(r"ESTORNO|DEVOLU") {
            return ("estorno", "outros".into(), None, "media".into());
        }
        return ("receita", "outras_receitas".into(), None, "baixa".into());
    }
    if rx(r"EMPRESTIMO|EMPRÉSTIMO|FINANCIAMENTO|PARC(ELA)? CRED") {
        return ("pagamento_divida", "emprestimos".into(), None, "media".into());
    }
    // Chave antiga: depois de migrar, `analisar` põe no grupo (`Classificador::finalizar`).
    let c = regras.classificar_chave(desc);
    let cat = if c.categoria == "transferencias_pix" { "transferencias".to_string() } else { c.categoria };
    ("despesa", cat, c.subcategoria, c.classificacao)
}

pub fn ler(nome: &str, bytes: &[u8], config: &Value, regras: &Classificador) -> Result<Extraido> {
    let t = texto(bytes);
    let lido = if t.to_uppercase().contains("<OFX>") || t.contains("OFXHEADER") { ler_ofx(&t)? } else { ler_csv(&t)? };
    if lido.lancamentos.is_empty() {
        bail!("o extrato não tem lançamentos");
    }
    // Conta: procura uma conta corrente cadastrada com o mesmo final; senão usa a primeira corrente.
    let contas = config.get("contas").and_then(Value::as_array).cloned().unwrap_or_default();
    let correntes: Vec<&Value> = contas.iter().filter(|c| c["tipo"].as_str().is_some_and(|t| t.contains("corrente"))).collect();
    let por_final = lido.final_conta.as_ref().and_then(|f| {
        correntes.iter().find(|c| c["final"].as_str().is_some_and(|x| {
            let a: String = x.chars().filter(char::is_ascii_alphanumeric).collect();
            a.ends_with(f.as_str()) || f.ends_with(a.as_str())
        }))
    });
    let mut avisos = Vec::new();
    let (conta_id, conta_nova) = match (por_final, correntes.first()) {
        (Some(c), _) => (c["id"].as_str().unwrap_or("conta").to_string(), None),
        (None, Some(c)) if lido.final_conta.is_none() => {
            avisos.push(format!("O arquivo não diz a conta; usei {}.", c["apelido"].as_str().or(c["id"].as_str()).unwrap_or("a conta corrente cadastrada")));
            (c["id"].as_str().unwrap_or("conta").to_string(), None)
        }
        _ => {
            let f = lido.final_conta.clone().unwrap_or_else(|| "0000".into());
            let id = format!("banco{}-corrente-{f}", lido.banco.clone().unwrap_or_default());
            let c = json!({ "id": id, "instituicao": lido.banco.clone().map(|b| format!("Banco {b}")), "tipo": "corrente", "apelido": format!("Conta final {f}"), "final": f });
            (id, Some(c))
        }
    };
    let ini = lido.lancamentos.iter().map(|l| l.data.as_str()).min().unwrap_or("").to_string();
    let fim = lido.lancamentos.iter().map(|l| l.data.as_str()).max().unwrap_or("").to_string();
    let doc_id = format!("doc-{}-extrato-{}-{}", &fim[..7], conta_id, &super::sha256_hex(t.as_bytes())[..6]);

    let mut movs = Vec::new();
    for (k, l) in lido.lancamentos.iter().enumerate() {
        let (nat, cat, sub, conf) = natureza(&l.descricao, l.valor, regras);
        let chave_desc = match &l.id_banco {
            Some(f) => format!("{}#{f}", l.descricao),
            None => l.descricao.clone(),
        };
        let h = hash_mov(&conta_id, &l.data, l.valor, &chave_desc, "", &l.data[..7]);
        movs.push(json!({
            "id": format!("{conta_id}-{}-{:04}-{}", &l.data[..7], k + 1, &h[..6]),
            "conta_id": conta_id,
            "data": l.data,
            "descricao": l.descricao,
            "valor": l.valor,
            "natureza": nat,
            "categoria": cat,
            "subcategoria": sub,
            "classificacao": conf,
            "recorrencia": if cat == "salario" { "fixa" } else { "variavel" },
            "origem": { "documento_id": doc_id, "id_banco": l.id_banco, "linha": k + 1 },
            "status": "confirmado",
            "hash": h,
        }));
    }
    let entradas = r2(lido.lancamentos.iter().filter(|l| l.valor > 0.0).map(|l| l.valor).sum());
    let saidas = r2(lido.lancamentos.iter().filter(|l| l.valor < 0.0).map(|l| l.valor).sum());
    let mut saldos = Vec::new();
    let mut resumo = vec![
        ("Período".to_string(), format!("{} a {}", fmt_data(&ini), fmt_data(&fim))),
        ("Lançamentos".to_string(), movs.len().to_string()),
        ("Entradas".to_string(), brl(entradas)),
        ("Saídas".to_string(), brl(saidas)),
    ];
    if let Some((d, v)) = &lido.saldo_final {
        resumo.push(("Saldo final".into(), format!("{} em {}", brl(*v), fmt_data(d))));
        saldos.push(json!({ "conta_id": conta_id, "competencia": &d[..7], "saldo_final": v, "data": d, "status": "confirmado", "origem": { "documento_id": doc_id } }));
    } else {
        avisos.push("O arquivo não traz o saldo final; o patrimônio continua sem o saldo desta conta.".into());
    }
    if ini[..7] != fim[..7] {
        avisos.push("O extrato cobre mais de um mês; cada lançamento entra no mês da sua data.".into());
    }
    if !movs.iter().any(|m| m["categoria"] == "salario") && movs.iter().any(|m| m["natureza"] == "receita") {
        avisos.push("Não identifiquei o crédito do salário; marque-o como Salário na lista, se estiver aí.".into());
    }
    let a_classificar = movs.iter().filter(|m| m["categoria"] == "a_classificar").count();
    if a_classificar > 0 {
        avisos.push(format!("{a_classificar} lançamento(s) sem categoria."));
    }
    Ok(Extraido {
        titulo: format!("Extrato · {}", nome_mes(&fim[..7])),
        competencia: Some(fim[..7].to_string()),
        resumo,
        conferencias: vec![],
        avisos,
        movimentacoes: movs,
        saldos,
        conta: conta_nova,
        documento: json!({
            "id": doc_id,
            "tipo": "extrato",
            "conta_id": conta_id,
            "periodo": [ini, fim],
            "formato": if nome.to_lowercase().ends_with(".ofx") { "ofx" } else { "csv" },
        }),
        ..Default::default()
    })
}

#[cfg(test)]
mod testes {
    use super::*;
    use serde_json::json;

    const OFX: &str = "OFXHEADER:100\nDATA:OFXSGML\n\n<OFX>\n<BANKMSGSRSV1><STMTTRNRS><STMTRS>\n<BANKACCTFROM>\n<BANKID>033\n<ACCTID>99990000123\n</BANKACCTFROM>\n<BANKTRANLIST>\n<STMTTRN>\n<TRNTYPE>CREDIT\n<DTPOSTED>20261006120000[-3:BRT]\n<TRNAMT>1200.50\n<FITID>A1\n<MEMO>PAGAMENTO DE SALARIO\n</STMTTRN>\n<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20261007\n<TRNAMT>-800.10\n<FITID>A2\n<MEMO>PAGAMENTO CARTAO DE CREDITO\n</STMTTRN>\n<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20261008\n<TRNAMT>-50.00\n<FITID>A3\n<MEMO>PIX ENVIADO FULANO\n</STMTTRN>\n</BANKTRANLIST>\n<LEDGERBAL>\n<BALAMT>120.31\n<DTASOF>20261010\n</LEDGERBAL>\n</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

    #[test]
    fn le_ofx_e_classifica() {
        let l = ler_ofx(OFX).unwrap();
        assert_eq!(l.lancamentos.len(), 3);
        assert_eq!(l.final_conta.as_deref(), Some("0123"));
        assert_eq!(l.saldo_final, Some(("2026-10-10".into(), 120.31)));
        let cfg = json!({ "contas": [{ "id": "santander-corrente", "tipo": "corrente", "final": "000-1" }] });
        let x = ler("extrato.ofx", OFX.as_bytes(), &cfg, &Classificador::novo(&json!({}))).unwrap();
        assert_eq!(x.movimentacoes[0]["categoria"], "salario");
        assert_eq!(x.movimentacoes[1]["natureza"], "transferencia_interna");
        assert_eq!(x.movimentacoes[2]["natureza"], "despesa");
        // Conta com final diferente vira conta nova, sem número completo.
        assert_eq!(x.conta.as_ref().unwrap()["final"], "0123");
    }

    #[test]
    fn le_csv_com_credito_e_debito() {
        let csv = "Extrato conta corrente\nData;Histórico;Documento;Crédito (R$);Débito (R$);Saldo (R$)\n01/10/2026;SALDO ANTERIOR;;;;100,00\n06/10/2026;PAGAMENTO SALARIO;;1.200,50;;1.300,50\n08/10/2026;PIX ENVIADO;;;-50,00;1.250,50\n";
        let l = ler_csv(csv).unwrap();
        assert_eq!(l.lancamentos.len(), 2);
        assert_eq!(l.lancamentos[0].valor, 1200.50);
        assert_eq!(l.lancamentos[1].valor, -50.0);
        assert_eq!(l.saldo_final, Some(("2026-10-08".into(), 1250.5)));
    }

    #[test]
    fn le_csv_com_valor_unico() {
        let csv = "Data,Descrição,Valor\n2026-10-06,\"SALARIO, EMPRESA\",\"2.345,67\"\n07/10/2026,PAGTO CARTAO,-800.10\n";
        let l = ler_csv(csv).unwrap();
        assert_eq!(l.lancamentos[0].descricao, "SALARIO, EMPRESA");
        assert_eq!(l.lancamentos[0].valor, 2345.67);
        assert_eq!(l.lancamentos[1].valor, -800.10);
    }
}
