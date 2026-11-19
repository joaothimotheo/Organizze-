//! Holerite ("Demonstrativo de Pagamento de Salário") em PDF.
//!
//! Proventos começam com "+" e terminam em "R$ valor"; descontos começam com "-"
//! e terminam em "(R$ valor)". Os totais do rodapé servem de conferência.

use anyhow::{bail, Result};
use regex::Regex;
use serde_json::{json, Value};

use super::fatura_santander::{fmt_data, nome_mes};
use super::{brl, data_br, r2, Conferencia, Extraido};
use crate::pdf::{valor_br, Pagina};

#[derive(Debug, Clone, PartialEq)]
pub struct Linha {
    pub provento: bool,
    pub descricao: String,
    pub referencia: Option<String>,
    pub valor: f64,
}

/// Lê uma linha "+ Horas Normais 220 R$ 2.500,00" ou "- INSS 12 (R$ 198,40)".
pub fn linha(t: &str) -> Option<Linha> {
    let t = t.trim();
    let (provento, resto) = if let Some(r) = t.strip_prefix('+') {
        (true, r)
    } else if let Some(r) = t.strip_prefix('-') {
        (false, r)
    } else {
        return None;
    };
    let mut toks: Vec<&str> = resto.split_whitespace().collect();
    let ult = toks.pop()?.trim_end_matches(')');
    let valor = valor_br(ult)?;
    match toks.last() {
        Some(&"R$") | Some(&"(R$") => {
            toks.pop();
        }
        _ => {}
    }
    let referencia = match toks.last() {
        Some(x) if x.chars().all(|c| c.is_ascii_digit() || c == '.' || c == ',') && toks.len() > 1 => toks.pop().map(String::from),
        _ => None,
    };
    if toks.is_empty() {
        return None;
    }
    Some(Linha { provento, descricao: toks.join(" "), referencia, valor })
}

fn tipo_desconto(d: &str) -> &'static str {
    let u = d.to_uppercase();
    if u.contains("ADTO") || u.contains("ADIANT") {
        "adiantamento"
    } else if u.starts_with("INSS") {
        "inss"
    } else if u.starts_with("IRRF") || u.starts_with("IR ") || u.contains("IMPOSTO DE RENDA") {
        "irrf"
    } else if u.contains("REFEI") || u.contains("ALIMENTA") {
        "vale_refeicao"
    } else if u.contains("TRANSPORTE") || u.starts_with("VT") {
        "vale_transporte"
    } else if u.contains("SINDICAL") || u.contains("SINDICATO") || u.contains("ASSISTENCIAL") {
        "contribuicao_sindical"
    } else if u.contains("SAUDE") || u.contains("SAÚDE") || u.contains("MEDIC") || u.contains("ODONTO") {
        "plano_saude"
    } else if u.contains("CONSIGNADO") || u.contains("EMPRESTIMO") || u.contains("EMPRÉSTIMO") {
        "emprestimo_consignado"
    } else {
        "outros"
    }
}

fn natureza_provento(d: &str) -> (&'static str, bool) {
    let u = d.to_uppercase();
    if u.contains("FÉRIAS") || u.contains("FERIAS") || u.contains("FÉR") || u.contains("ABONO PECUNI") {
        ("ferias", false)
    } else if u.contains("13") && (u.contains("SAL") || u.contains("º") || u.contains("PARCELA")) {
        ("decimo_terceiro", false)
    } else if u.contains("EXTRA") {
        ("hora_extra", false)
    } else if u.contains("PLR") || u.contains("PARTICIPA") || u.contains("BONUS") || u.contains("BÔNUS") || u.contains("PREMIO") || u.contains("PRÊMIO") {
        ("bonus", false)
    } else if u.contains("HORAS NORMAIS") || u.contains("SALARIO") || u.contains("SALÁRIO") {
        ("salario", true)
    } else {
        ("outros", false)
    }
}

pub fn ler(paginas: &[Pagina]) -> Result<Extraido> {
    let texto: String = paginas.iter().map(|p| p.texto()).collect::<Vec<_>>().join("\n");
    let achar = |rx: &str| Regex::new(rx).unwrap().captures(&texto).map(|c| c[1].trim().to_string());
    let valor = |rx: &str| achar(rx).and_then(|v| valor_br(&v));

    let Some(comp) = achar(r"Pagamento de Sal[áa]rio:\s*(\d{2}/\d{2})") else { bail!("não encontrei a competência (\"Demonstrativo de Pagamento de Salário: mm/aa\")") };
    let competencia = format!("20{}-{}", &comp[3..5], &comp[..2]);
    let calculo = achar(r"C[áa]lculo ([^\n]+)").unwrap_or_else(|| "Mensal".into());
    let tipo = match calculo.to_lowercase().as_str() {
        x if x.starts_with("mensal") => "mensal".to_string(),
        x if x.contains("13") => "decimo_terceiro".to_string(),
        x if x.contains("férias") || x.contains("ferias") => "ferias".to_string(),
        x if x.contains("rescis") => "rescisao".to_string(),
        x => x.split_whitespace().collect::<Vec<_>>().join("_"),
    };
    let empregador = achar(r"Empresa:\s*(.+?)\s+CNPJ").unwrap_or_default();
    let cnpj = achar(r"CNPJ:\s*([\d./-]+)");
    let cargo = achar(r"Cargo:\s*([^\n]+)");
    let pagamento = achar(r"Data de pagamento:\s*(\d{2}/\d{2}/\d{4})").and_then(|d| data_br(&d));

    let mut proventos = Vec::new();
    let mut descontos = Vec::new();
    for l in texto.lines() {
        let Some(x) = linha(l) else { continue };
        if x.provento {
            let (nat, rec) = natureza_provento(&x.descricao);
            proventos.push(json!({ "codigo": null, "descricao": x.descricao, "referencia": x.referencia, "valor": x.valor, "recorrente": rec, "natureza": nat }));
        } else {
            let t = tipo_desconto(&x.descricao);
            let mut d = json!({ "codigo": null, "descricao": x.descricao, "referencia": x.referencia, "valor": x.valor, "tipo": t });
            if t == "contribuicao_sindical" {
                d["recorrente"] = json!(false);
            }
            descontos.push(d);
        }
    }
    if proventos.is_empty() {
        bail!("não encontrei os proventos do holerite");
    }

    let soma = |l: &[Value]| r2(l.iter().map(|x| x["valor"].as_f64().unwrap_or(0.0)).sum());
    let bruto_calc = soma(&proventos);
    let desc_calc = soma(&descontos);
    let tot = Regex::new(r"Total\s+\(R\$\s*([\d.]+,\d{2})\)\s+R\$\s*([\d.]+,\d{2})").unwrap().captures(&texto);
    let (desc_doc, bruto_doc) = match &tot {
        Some(c) => (valor_br(&c[1]), valor_br(&c[2])),
        None => (None, Regex::new(r"Total\s+R\$\s*([\d.]+,\d{2})").unwrap().captures(&texto).and_then(|c| valor_br(&c[1]))),
    };
    let liquido = valor(r"Valor l[íi]quido a receber:\s*R\$\s*([\d.]+,\d{2})");
    let Some(liquido) = liquido else { bail!("não encontrei o valor líquido a receber") };
    let bruto = bruto_doc.unwrap_or(bruto_calc);
    let total_desc = desc_doc.unwrap_or(desc_calc);

    let mut conferencias = vec![
        Conferencia::nova("Proventos (total do holerite) × soma das linhas", bruto, bruto_calc),
        Conferencia::nova("Descontos (total do holerite) × soma das linhas", total_desc, desc_calc),
        Conferencia::nova("Líquido × proventos − descontos", liquido, bruto_calc - desc_calc),
    ];
    conferencias.retain(|c| c.no_documento != 0.0 || c.calculado != 0.0);
    let mut avisos = Vec::new();
    let adiantamento = r2(descontos.iter().filter(|d| d["tipo"] == "adiantamento").map(|d| d["valor"].as_f64().unwrap_or(0.0)).sum());
    if adiantamento > 0.0 {
        avisos.push(format!(
            "Há {} de adiantamento já pago antes (ex.: férias). Para o mês, conto o líquido + adiantamento = {}.",
            brl(adiantamento),
            brl(liquido + adiantamento)
        ));
    }
    let irrf = r2(descontos.iter().filter(|d| d["tipo"] == "irrf").map(|d| d["valor"].as_f64().unwrap_or(0.0)).sum());
    let base_salario = valor(r"Sal[áa]rio base:\s*R\$\s*([\d.]+,\d{2})");
    let id = format!("hol-{competencia}-{tipo}");
    let doc_id = format!("doc-{competencia}-holerite-{tipo}");
    let mut reg = json!({
        "id": id,
        "competencia": competencia,
        "empregador": empregador,
        "cargo": cargo,
        "data_pagamento": pagamento,
        "tipo": tipo,
        "proventos": proventos,
        "descontos": descontos,
        "bruto": bruto,
        "total_descontos": total_desc,
        "liquido": liquido,
        "liquido_competencia": r2(liquido + adiantamento),
        "salario_base": base_salario,
        "base_inss": valor(r"Base de c[áa]lculo INSS:\s*R\$\s*([\d.]+,\d{2})"),
        "base_irrf": valor(r"Base de c[áa]lculo IR:\s*R\$\s*([\d.]+,\d{2})"),
        "base_fgts": valor(r"Base de c[áa]lculo FGTS:\s*R\$\s*([\d.]+,\d{2})"),
        "fgts": valor(r"FGTS do m[êe]s:\s*R\$\s*([\d.]+,\d{2})"),
        "irrf": irrf,
        "origem": { "documento_id": doc_id, "pagina": 1 },
        "status": "confirmado",
    });
    if conferencias.iter().any(|c| !c.ok) {
        reg["status"] = json!("pendente");
        avisos.push("Algum total não bateu; o holerite será gravado como pendente de conferência.".into());
    }

    let mut resumo = vec![
        ("Competência".to_string(), nome_mes(&competencia)),
        ("Tipo".to_string(), calculo.clone()),
        ("Bruto".to_string(), brl(bruto)),
        ("Descontos".to_string(), brl(total_desc)),
        ("Líquido".to_string(), brl(liquido)),
    ];
    if let Some(p) = &pagamento {
        resumo.insert(1, ("Pagamento".into(), fmt_data(p)));
    }

    Ok(Extraido {
        titulo: format!("Holerite · {}", nome_mes(&competencia)),
        competencia: Some(competencia.clone()),
        resumo,
        conferencias,
        avisos,
        holerite: Some(reg),
        documento: json!({
            "id": doc_id,
            "tipo": "holerite",
            "instituicao": match cnpj { Some(c) => format!("{empregador} (CNPJ {c})"), None => empregador.clone() },
            "competencia": competencia,
        }),
        ..Default::default()
    })
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn le_linhas_de_provento_e_desconto() {
        assert_eq!(
            linha("+ Horas Normais 220 R$ 2.500,00"),
            Some(Linha { provento: true, descricao: "Horas Normais".into(), referencia: Some("220".into()), valor: 2500.0 })
        );
        assert_eq!(
            linha("- Desconto Adto Férias 0 (R$ 1.234,56)"),
            Some(Linha { provento: false, descricao: "Desconto Adto Férias".into(), referencia: Some("0".into()), valor: 1234.56 })
        );
        assert_eq!(linha("+ 1/3 Férias 0 R$ 345,67").unwrap().descricao, "1/3 Férias");
        assert_eq!(linha("Total (R$ 210,30) R$ 2.500,00"), None);
        assert_eq!(tipo_desconto("Vale Refeicao P.A.T."), "vale_refeicao");
        assert_eq!(tipo_desconto("INSS Férias"), "inss");
    }
}
