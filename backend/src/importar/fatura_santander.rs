//! Fatura de cartão de crédito do Santander (layout de 2026, em PDF sem senha).
//!
//! O detalhamento vem em duas colunas por página. Cada coluna é lida separadamente,
//! do título "Detalhamento" até o "Resumo da Fatura" (ou o rodapé de juros).

use anyhow::{bail, Result};
use regex::Regex;
use serde_json::{json, Value};

use super::classificar::Classificador;
use super::{brl, data_br, hash_mov, r2, Conferencia, Extraido};
use crate::pdf::{juntar, linhas, valor_br, Pagina, Palavra};

#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    pub cartao: Option<String>,
    pub secao: String,
    pub data: String,
    pub descricao: String,
    pub parcela: Option<String>,
    pub valor: f64,
    /// Linha "*Juros = x / IOF = y" logo abaixo do item (Pix parcelado no cartão).
    pub juros: f64,
    pub iof: f64,
}

#[derive(Debug, Default)]
pub struct Cabecalho {
    pub final_titular: Option<String>,
    pub bandeira: Option<String>,
    pub vencimento: Option<String>,
    pub periodo: Option<(String, String)>,
    pub total_fatura: Option<f64>,
    pub despesas_brasil: Option<f64>,
    pub despesas_exterior: Option<f64>,
    pub pagamentos: Option<f64>,
    pub creditos: Option<f64>,
    pub parcelas_a_vencer: Option<f64>,
    pub limite: Option<f64>,
    pub juros_rotativo: Option<String>,
}

fn eh_data_curta(s: &str) -> bool {
    s.len() == 5 && s.as_bytes()[2] == b'/' && s[..2].chars().all(|c| c.is_ascii_digit()) && s[3..].chars().all(|c| c.is_ascii_digit())
}

/// Itens do detalhamento, na ordem em que aparecem.
pub fn itens(paginas: &[Pagina]) -> Vec<Item> {
    let mut colunas: Vec<Vec<Vec<&Palavra>>> = Vec::new();
    for p in paginas {
        if !p.texto().contains("Detalhamento da Fatura") {
            continue;
        }
        let meio = p.largura / 2.0;
        let topo = p.palavras.iter().filter(|w| w.texto == "Detalhamento").map(|w| w.y).fold(f64::INFINITY, f64::min);
        let topo = if topo.is_finite() { topo } else { 0.0 };
        let fim = p.palavras.iter().filter(|w| w.texto == "Juros" && w.x0 < 60.0).map(|w| w.y).fold(p.altura, f64::min);
        for esquerda in [true, false] {
            let lado: Vec<&Palavra> = p.palavras.iter().filter(|w| (w.x0 < meio) == esquerda).collect();
            let resumo = lado.iter().filter(|w| w.texto == "Resumo").map(|w| w.y).fold(fim, f64::min);
            let limite = resumo.min(fim);
            let col: Vec<&Palavra> = lado.into_iter().filter(|w| w.y > topo && w.y < limite).collect();
            colunas.push(linhas(col));
        }
    }

    let rx_cartao = Regex::new(r"XXXX XXXX (\d{4})").unwrap();
    let rx_enc = Regex::new(r"Juros = ([\d.,]+) / IOF = ([\d.,]+)").unwrap();
    let mut out: Vec<Item> = Vec::new();
    let mut cartao = None;
    let mut secao = String::new();
    for col in colunas {
        for l in col {
            let t = juntar(&l);
            if let Some(c) = rx_cartao.captures(&t) {
                cartao = Some(c[1].to_string());
                continue;
            }
            if t.starts_with("Pagamento e Demais") {
                secao = "pagamentos".into();
                continue;
            }
            if t.starts_with("Parcelamentos") {
                secao = "parcelamentos".into();
                continue;
            }
            if t.starts_with("Despesas") {
                secao = "despesas".into();
                continue;
            }
            if t.starts_with("*Juros") {
                if let (Some(c), Some(ult)) = (rx_enc.captures(&t), out.last_mut()) {
                    ult.juros = valor_br(&c[1]).unwrap_or(0.0);
                    ult.iof = valor_br(&c[2]).unwrap_or(0.0);
                }
                continue;
            }
            let mut toks: Vec<&str> = l.iter().map(|p| p.texto.as_str()).collect();
            // Marcador de um dígito antes da data (ícone do tipo de compra).
            if toks.first().is_some_and(|x| x.len() == 1 && x.chars().all(|c| c.is_ascii_digit())) {
                toks.remove(0);
            }
            if toks.first().map_or(true, |x| !eh_data_curta(x)) {
                continue;
            }
            let data = toks.remove(0).to_string();
            let mut valores = Vec::new();
            while toks.last().and_then(|x| valor_br(x)).is_some() {
                valores.insert(0, valor_br(toks.pop().unwrap()).unwrap());
            }
            let Some(&valor) = valores.first() else { continue };
            let parcela = if toks.last().is_some_and(|x| eh_data_curta(x)) { toks.pop().map(String::from) } else { None };
            out.push(Item {
                cartao: cartao.clone(),
                secao: secao.clone(),
                data,
                descricao: toks.join(" "),
                parcela,
                valor,
                juros: 0.0,
                iof: 0.0,
            });
        }
    }
    out
}

pub fn cabecalho(paginas: &[Pagina]) -> Cabecalho {
    let texto: Vec<String> = paginas.iter().map(|p| p.texto()).collect();
    let tudo = texto.join("\n");
    let mut c = Cabecalho::default();
    let num = r"(-?[\d.]+,\d{2})";
    let pega = |rx: &str| Regex::new(rx).unwrap().captures(&tudo).and_then(|m| valor_br(&m[1]));
    c.final_titular = Regex::new(r"XXXX XXXX (\d{4})").unwrap().captures(&tudo).map(|m| m[1].to_string());
    let up = tudo.to_uppercase();
    c.bandeira = ["VISA", "MASTERCARD", "ELO", "AMEX"].iter().find(|b| up.contains(*b)).map(|b| b.to_lowercase());
    c.total_fatura = pega(&format!(r"Saldo Desta Fatura\s+{num}"));
    c.despesas_brasil = pega(&format!(r"Total Despesas/D[ée]bitos no Brasil\s+{num}"));
    c.despesas_exterior = pega(&format!(r"Total Despesas/D[ée]bitos no Exterior\s+{num}"));
    c.pagamentos = pega(&format!(r"Total de pagamentos\s+{num}"));
    c.creditos = pega(&format!(r"Total de cr[ée]ditos\s+{num}"));
    c.parcelas_a_vencer = pega(&format!(r"opera[çc][õo]es de\s+{num}"));
    c.limite = pega(r"Seu limite é[\s\S]{0,80}?R\$ ?([\d.]+,\d{2})");
    c.juros_rotativo = Regex::new(r"Cr[ée]dito Rotativo: Juros: ([\d,]+% a\.m\.)").unwrap().captures(&tudo).map(|m| m[1].to_string());
    if let Some(m) = Regex::new(r"Esta Fatura (\d{2}/\d{2}/\d{2}) a (\d{2}/\d{2}/\d{2})").unwrap().captures(&tudo) {
        if let (Some(a), Some(b)) = (data_br(&m[1]), data_br(&m[2])) {
            c.periodo = Some((a, b));
        }
    }
    // Vencimento: primeira data completa na linha seguinte a "Total a Pagar ... Vencimento".
    'fora: for t in &texto {
        let ls: Vec<&str> = t.lines().collect();
        for (i, l) in ls.iter().enumerate() {
            if l.contains("Total a Pagar") && l.contains("Vencimento") {
                for prox in ls.iter().skip(i + 1).take(2) {
                    if let Some(m) = Regex::new(r"(\d{2}/\d{2}/\d{4})").unwrap().captures(prox) {
                        c.vencimento = data_br(&m[1]);
                        break 'fora;
                    }
                }
            }
        }
    }
    c
}

/// Assinatura e tarifa são fixas. Decide pela chave crua da regra (antes da tradução para grupo),
/// para não perder o "fixa" quando Assinaturas não virou grupo na migração.
fn recorrencia(regras: &Classificador, desc: &str) -> &'static str {
    let c = regras.classificar_chave(desc).categoria;
    if c == "assinaturas" || c == "tarifas_bancarias" { "fixa" } else { "variavel" }
}

pub fn ler(paginas: &[Pagina], regras: &Classificador) -> Result<Extraido> {
    let tudo: String = paginas.iter().map(|p| p.texto()).collect::<Vec<_>>().join("\n");
    if !tudo.to_uppercase().contains("SANTANDER") {
        bail!("por enquanto só leio faturas do Santander; envie esta por aqui no chat que eu crio o leitor");
    }
    let cab = cabecalho(paginas);
    let lista = itens(paginas);
    if lista.is_empty() {
        bail!("não encontrei lançamentos no detalhamento da fatura");
    }
    let Some(final_cartao) = cab.final_titular.clone() else { bail!("não encontrei o final do cartão na fatura") };
    let Some((_inicio, fechamento)) = cab.periodo.clone() else { bail!("não encontrei o período da fatura (\"Esta Fatura dd/mm/aa a dd/mm/aa\")") };
    let ciclo = fechamento[..7].to_string();
    let (ano_c, mes_c): (i32, u32) = (ciclo[..4].parse()?, ciclo[5..].parse()?);
    let bandeira = cab.bandeira.clone().unwrap_or_else(|| "cartao".into());
    let conta = format!("santander-{bandeira}-{final_cartao}");
    let doc_id = format!("doc-{ciclo}-fatura-{bandeira}{final_cartao}");
    let prefixo = format!("cartao{final_cartao}-{ciclo}");

    let mut geradas: Vec<Value> = Vec::new();
    let mut adicionais = std::collections::BTreeSet::new();
    for it in &lista {
        if let Some(c) = &it.cartao {
            if *c != final_cartao {
                adicionais.insert(c.clone());
            }
        }
        let (dd, mm): (u32, u32) = (it.data[..2].parse()?, it.data[3..].parse()?);
        let ano = if mm <= mes_c { ano_c } else { ano_c - 1 };
        let data_compra = format!("{ano:04}-{mm:02}-{dd:02}");
        let base = json!({
            "conta_id": conta,
            "descricao": it.descricao,
            "competencia": ciclo,
            "origem": { "documento_id": doc_id, "secao": it.secao, "cartao_final": it.cartao },
            "status": "confirmado",
        });
        let mut reg = base.clone();
        if it.secao == "pagamentos" {
            reg["data"] = json!(data_compra);
            reg["valor"] = json!(r2(-it.valor));
            if it.descricao.contains("PAGAMENTO DE FATURA") {
                reg["natureza"] = json!("transferencia_interna");
                reg["categoria"] = json!("pagamento_fatura_cartao");
                reg["recorrencia"] = json!("fixa");
            } else {
                reg["natureza"] = json!("estorno");
                reg["categoria"] = json!("compras");
                reg["recorrencia"] = json!("eventual");
            }
            geradas.push(reg);
            continue;
        }
        let cl = regras.classificar(&it.descricao);
        let parcelado = it.parcela.is_some();
        reg["data"] = json!(if parcelado { fechamento.clone() } else { data_compra.clone() });
        reg["valor"] = json!(r2(-it.valor));
        reg["natureza"] = json!("despesa");
        reg["categoria"] = json!(cl.categoria);
        reg["subcategoria"] = json!(cl.subcategoria);
        reg["classificacao"] = json!(cl.classificacao);
        reg["recorrencia"] = json!(recorrencia(regras, &it.descricao));
        if let Some(p) = &it.parcela {
            reg["parcela"] = json!(p);
            reg["data_compra"] = json!(data_compra);
        }
        if it.juros > 0.0 || it.iof > 0.0 {
            reg["valor"] = json!(r2(-(it.valor - it.juros - it.iof)));
            reg["obs"] = json!(format!(
                "Valor na fatura R$ {:.2}, inclui juros R$ {:.2} e IOF R$ {:.2} (lançados à parte)",
                it.valor, it.juros, it.iof
            ));
            let data = reg["data"].clone();
            geradas.push(reg);
            let mut enc = base.clone();
            enc["data"] = data;
            enc["valor"] = json!(r2(-(it.juros + it.iof)));
            enc["natureza"] = json!("despesa");
            enc["categoria"] = json!("encargos_financeiros");
            enc["subcategoria"] = json!("juros e IOF de PIX no cartão");
            enc["classificacao"] = json!("alta");
            enc["recorrencia"] = json!("eventual");
            enc["descricao"] = json!(format!("Juros/IOF · {}", it.descricao));
            geradas.push(enc);
            continue;
        }
        geradas.push(reg);
    }
    for (k, g) in geradas.iter_mut().enumerate() {
        g["id"] = json!(format!("{prefixo}-{:03}", k + 1));
        let h = hash_mov(
            &conta,
            g["data"].as_str().unwrap_or(""),
            g["valor"].as_f64().unwrap_or(0.0),
            g["descricao"].as_str().unwrap_or(""),
            g.get("parcela").and_then(Value::as_str).unwrap_or(""),
            &ciclo,
        );
        g["hash"] = json!(h);
    }

    let soma_desp = r2(geradas.iter().filter(|g| g["natureza"] == "despesa").map(|g| -g["valor"].as_f64().unwrap_or(0.0)).sum());
    let soma_pag = r2(geradas.iter().filter(|g| g["natureza"] != "despesa").map(|g| g["valor"].as_f64().unwrap_or(0.0).abs()).sum());
    let mut conferencias = Vec::new();
    let mut avisos = Vec::new();
    match cab.despesas_brasil {
        Some(v) => conferencias.push(Conferencia::nova("Despesas no Brasil (resumo da fatura) × soma dos lançamentos", v, soma_desp)),
        None => avisos.push("Não encontrei o total de despesas no resumo; confira os lançamentos com atenção.".into()),
    }
    if cab.despesas_exterior.is_some_and(|v| v > 0.0) {
        avisos.push("A fatura tem despesas no exterior; elas ainda não são separadas automaticamente.".into());
    }
    if let Some(v) = cab.pagamentos {
        conferencias.push(Conferencia::nova("Pagamentos e créditos (resumo) × soma dos lançamentos", v + cab.creditos.unwrap_or(0.0), soma_pag));
    }
    let a_classificar = geradas.iter().filter(|g| g["categoria"] == "a_classificar").count();
    if a_classificar > 0 {
        avisos.push(format!("{a_classificar} lançamento(s) sem categoria; escolha na lista antes de gravar ou depois."));
    }

    let total = cab.total_fatura;
    let futuras = cab.parcelas_a_vencer;
    let (divida, divida_saldo) = match (total, futuras) {
        (Some(t), Some(f)) => (
            Some(json!({
                "id": format!("cartao-{bandeira}-{final_cartao}"),
                "credor": "Santander",
                "tipo": "cartao_de_credito",
                "conta_id": conta,
                "taxa_mensal": null,
                "obs": "Saldo = fatura fechada + parcelas a vencer (igual ao limite utilizado).",
                "saldos": [],
                "situacao": "ativa",
            })),
            Some(json!({
                "data": fechamento,
                "saldo_devedor": r2(t + f),
                "fatura": t,
                "parcelas_a_vencer": f,
                "status": "confirmado",
                "origem": { "documento_id": doc_id },
            })),
        ),
        _ => {
            avisos.push("Não encontrei o total da fatura ou das parcelas a vencer; o saldo da dívida do cartão não será atualizado.".into());
            (None, None)
        }
    };

    let mut resumo = vec![
        ("Cartão".to_string(), format!("Santander {} final {}", bandeira.to_uppercase(), final_cartao)),
        ("Período".to_string(), format!("até {}", fmt_data(&fechamento))),
    ];
    if let Some(v) = &cab.vencimento {
        resumo.push(("Vencimento".into(), fmt_data(v)));
    }
    if let Some(t) = total {
        resumo.push(("Total da fatura".into(), brl(t)));
    }
    if let Some(f) = futuras {
        resumo.push(("Parcelas a vencer".into(), brl(f)));
    }
    resumo.push(("Lançamentos".into(), geradas.len().to_string()));
    let apelido = if adicionais.is_empty() {
        format!("Santander {} final {final_cartao}", bandeira.to_uppercase())
    } else {
        format!("Santander {} (titular {final_cartao} + adicional {})", bandeira.to_uppercase(), adicionais.iter().cloned().collect::<Vec<_>>().join(", "))
    };

    Ok(Extraido {
        titulo: format!("Fatura do cartão final {final_cartao} · {}", nome_mes(&ciclo)),
        competencia: Some(ciclo.clone()),
        resumo,
        conferencias,
        avisos,
        holerite: None,
        movimentacoes: geradas,
        saldos: vec![],
        divida,
        divida_saldo,
        conta: Some(json!({
            "id": conta,
            "instituicao": "Banco Santander (33)",
            "tipo": "cartao",
            "apelido": apelido,
            "final": final_cartao,
            "limite": cab.limite,
            "vencimento_dia": cab.vencimento.as_ref().and_then(|v| v[8..].parse::<u32>().ok()),
        })),
        documento: json!({
            "id": doc_id,
            "tipo": "fatura_cartao",
            "instituicao": apelido,
            "competencia": ciclo,
            "fechamento": fechamento,
            "vencimento": cab.vencimento,
            "total_fatura": total,
            "despesas_no_periodo": cab.despesas_brasil,
            "parcelas_a_vencer": futuras,
            "juros_rotativo": cab.juros_rotativo,
        }),
    })
}

pub fn fmt_data(iso: &str) -> String {
    if iso.len() == 10 {
        format!("{}/{}/{}", &iso[8..10], &iso[5..7], &iso[..4])
    } else {
        iso.to_string()
    }
}

pub fn nome_mes(comp: &str) -> String {
    const M: [&str; 12] = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    let m: usize = comp.get(5..7).and_then(|x| x.parse().ok()).unwrap_or(1);
    format!("{}/{}", M[(m.clamp(1, 12)) - 1], comp.get(..4).unwrap_or(""))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn recorrencia_pela_chave_da_regra() {
        let sem_migrar = Classificador::novo(&json!({}));
        assert_eq!(recorrencia(&sem_migrar, "NETFLIX.COM"), "fixa");
        assert_eq!(recorrencia(&sem_migrar, "LOJA QUALQUER"), "variavel");
        let mut cats = json!({});
        crate::categorias::migrar(&mut cats, &mut json!({ "movimentacoes": [] }), &[], "2026-11-19T10:00:00-03:00").unwrap();
        let migrado = Classificador::novo(&json!({})).com_grupos(&cats);
        assert_eq!(migrado.classificar("NETFLIX.COM").categoria, "a_classificar", "Assinaturas não virou grupo");
        assert_eq!(recorrencia(&migrado, "NETFLIX.COM"), "fixa");
    }
}
