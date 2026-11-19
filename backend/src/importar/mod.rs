//! Importação de documentos: holerite, fatura de cartão e extrato bancário.
//!
//! O fluxo tem duas etapas. `analisar` lê o arquivo e monta uma prévia (nada é gravado).
//! Depois de você revisar, `aplicar` grava os registros e o documento original.

pub mod classificar;
pub mod extrato;
pub mod fatura_santander;
pub mod holerite;

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

use crate::armazenamento::Armazenamento;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TipoDocumento {
    Holerite,
    FaturaCartao,
    Extrato,
}

#[derive(Debug, Clone, Serialize)]
pub struct Conferencia {
    pub descricao: String,
    pub no_documento: f64,
    pub calculado: f64,
    pub ok: bool,
}

impl Conferencia {
    pub fn nova(descricao: impl Into<String>, no_documento: f64, calculado: f64) -> Self {
        Self { descricao: descricao.into(), no_documento: r2(no_documento), calculado: r2(calculado), ok: (no_documento - calculado).abs() < 0.015 }
    }
}

/// O que um importador extraiu do arquivo, antes de comparar com o que já existe.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Extraido {
    pub titulo: String,
    pub competencia: Option<String>,
    /// Pares rótulo/valor para mostrar no resumo da prévia.
    pub resumo: Vec<(String, String)>,
    pub conferencias: Vec<Conferencia>,
    pub avisos: Vec<String>,
    pub holerite: Option<Value>,
    pub movimentacoes: Vec<Value>,
    /// Saldo final de conta (extrato).
    pub saldos: Vec<Value>,
    /// Saldo de dívida a registrar (fatura do cartão).
    pub divida: Option<Value>,
    pub divida_saldo: Option<Value>,
    pub conta: Option<Value>,
    /// Entrada para documentos.json, sem os campos de controle (sha, datas).
    pub documento: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct Previa {
    pub id: String,
    pub tipo: TipoDocumento,
    pub nome_arquivo: String,
    pub sha256: String,
    /// O mesmo arquivo já foi importado antes.
    pub ja_importado: bool,
    /// O arquivo original já está guardado.
    pub original_guardado: bool,
    /// Já existe um holerite com o mesmo id (será substituído).
    pub substitui_holerite: bool,
    pub duplicadas: usize,
    pub categorias: Vec<(String, String)>,
    #[serde(flatten)]
    pub dados: Extraido,
}

/// Ajustes feitos por você na tela de revisão.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Ajustes {
    /// id da movimentação → nova categoria
    pub categorias: HashMap<String, String>,
    /// ids de movimentações para não gravar
    pub ignorar: Vec<String>,
}

pub fn r2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Hash curto que identifica um lançamento (mesma fórmula usada nas importações anteriores).
pub fn hash_mov(conta: &str, data: &str, valor: f64, descricao: &str, parcela: &str, ciclo: &str) -> String {
    let chave = format!("{conta}|{data}|{valor:.2}|{descricao}|{parcela}|{ciclo}");
    sha256_hex(chave.as_bytes())[..16].to_string()
}

/// Descobre o tipo do arquivo pelo conteúdo.
pub fn detectar(nome: &str, bytes: &[u8]) -> Result<TipoDocumento> {
    let n = nome.to_lowercase();
    if n.ends_with(".ofx") || bytes.windows(9).take(4096).any(|w| w.eq_ignore_ascii_case(b"<OFX>\r\n<") || w.eq_ignore_ascii_case(b"OFXHEADER")) {
        return Ok(TipoDocumento::Extrato);
    }
    if n.ends_with(".csv") || n.ends_with(".txt") {
        return Ok(TipoDocumento::Extrato);
    }
    if bytes.starts_with(b"%PDF") {
        let paginas = crate::pdf::extrair(bytes)?;
        let texto: String = paginas.iter().map(|p| p.texto()).collect::<Vec<_>>().join("\n");
        if texto.contains("Demonstrativo de Pagamento") || texto.contains("Valor líquido a receber") {
            return Ok(TipoDocumento::Holerite);
        }
        if texto.contains("Detalhamento da Fatura") {
            return Ok(TipoDocumento::FaturaCartao);
        }
        if texto.to_lowercase().contains("extrato") {
            bail!("extrato em PDF ainda não é lido automaticamente; exporte o extrato em OFX ou CSV no app ou site do banco");
        }
        bail!("não reconheci este PDF como holerite ou fatura de cartão");
    }
    if n.ends_with(".xls") || n.ends_with(".xlsx") {
        bail!("planilha Excel ainda não é lida; exporte o extrato em OFX ou CSV");
    }
    bail!("formato não reconhecido; envie PDF (holerite ou fatura), OFX ou CSV")
}

/// Lê o arquivo e monta a prévia comparando com os dados atuais.
pub async fn analisar(arm: &Armazenamento, id: String, nome: &str, bytes: &[u8]) -> Result<Previa> {
    let tipo = detectar(nome, bytes)?;
    let sha = sha256_hex(bytes);
    let config = arm.ler_json("config").await?;
    let movs = arm.ler_json("movimentacoes").await?;
    let docs = arm.ler_json("documentos").await?;
    let hol = arm.ler_json("holerites").await?;
    let cats = arm.ler_json("categorias").await?;
    let regras = classificar::Classificador::novo(&movs).sem(crate::categorias::ocultas(&cats)).com_grupos(&cats);

    let dados = match tipo {
        TipoDocumento::Holerite => holerite::ler(&crate::pdf::extrair(bytes)?)?,
        TipoDocumento::FaturaCartao => fatura_santander::ler(&crate::pdf::extrair(bytes)?, &regras)?,
        TipoDocumento::Extrato => extrato::ler(nome, bytes, &config, &regras)?,
    };

    let ja_importado = lista(&docs, "documentos").iter().any(|d| d.get("sha256").and_then(Value::as_str) == Some(sha.as_str()));
    let substitui_holerite = dados
        .holerite
        .as_ref()
        .and_then(|h| h.get("id"))
        .is_some_and(|hid| lista(&hol, "holerites").iter().any(|x| x.get("id") == Some(hid)));
    let existentes: HashSet<&str> = lista(&movs, "movimentacoes").iter().filter_map(|m| m.get("hash").and_then(Value::as_str)).collect();
    let mut dados = dados;
    let mut duplicadas = 0;
    for m in &mut dados.movimentacoes {
        // Depois de migrar, a chave antiga vira o grupo (antes de migrar, não muda nada).
        regras.finalizar(m);
        let dup = m.get("hash").and_then(Value::as_str).is_some_and(|h| existentes.contains(h));
        if dup {
            duplicadas += 1;
        }
        m["duplicada"] = json!(dup);
    }
    // Meses que já vieram pelo banco (Open Finance): gravar o documento duplicaria os lançamentos.
    let do_banco: HashSet<(String, String)> = lista(&movs, "movimentacoes")
        .iter()
        .filter(|m| m["origem"]["fonte"].as_str() == Some("pluggy"))
        .filter_map(|m| Some((m["conta_id"].as_str()?.to_string(), m["competencia"].as_str()?.to_string())))
        .collect();
    let mut meses_do_banco: Vec<String> = dados
        .movimentacoes
        .iter()
        .filter_map(|m| Some((m["conta_id"].as_str()?.to_string(), m["competencia"].as_str().or(m["data"].as_str().map(|d| &d[..7]))?.to_string())))
        .filter(|chave| do_banco.contains(chave))
        .map(|(_, comp)| comp)
        .collect();
    meses_do_banco.sort();
    meses_do_banco.dedup();
    if !meses_do_banco.is_empty() {
        dados.avisos.insert(
            0,
            format!(
                "Atenção: {} já {} pelo banco (sincronização automática). Gravar este documento vai duplicar os lançamentos desse período.",
                meses_do_banco.iter().map(|c| fatura_santander::nome_mes(c)).collect::<Vec<_>>().join(", "),
                if meses_do_banco.len() == 1 { "veio" } else { "vieram" }
            ),
        );
    }
    let original_guardado = arm.tem_original(&sha).await?;
    Ok(Previa {
        id,
        tipo,
        nome_arquivo: nome.to_string(),
        sha256: sha,
        ja_importado,
        original_guardado,
        substitui_holerite,
        duplicadas,
        categorias: if crate::categorias::migrado(&cats) { crate::categorias::grupos(&cats) } else { crate::categorias::todas(&cats) }
            .iter()
            .map(|c| (c["id"].as_str().unwrap_or_default().to_string(), c["nome"].as_str().unwrap_or_default().to_string()))
            .collect(),
        dados,
    })
}

fn lista<'a>(doc: &'a Value, chave: &str) -> &'a [Value] {
    doc.get(chave).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn garantir_lista<'a>(doc: &'a mut Value, chave: &str) -> &'a mut Vec<Value> {
    if !doc.is_object() {
        *doc = json!({ "schema_version": 1 });
    }
    if !doc.get(chave).is_some_and(Value::is_array) {
        doc[chave] = json!([]);
    }
    doc[chave].as_array_mut().unwrap()
}

#[derive(Debug, Serialize)]
pub struct Resultado {
    pub documento_id: String,
    pub holerite: bool,
    pub movimentacoes_gravadas: usize,
    pub movimentacoes_ignoradas: usize,
    pub saldo_divida: bool,
    pub original_guardado: bool,
    /// O documento já tinha sido importado; só o arquivo original foi guardado.
    pub so_original: bool,
}

/// Grava a prévia revisada. Deve ser chamada com a trava de escrita.
pub async fn aplicar(arm: &Armazenamento, p: &Previa, bytes: &[u8], ajustes: &Ajustes, agora: &str) -> Result<Resultado> {
    let mut docs = arm.ler_json("documentos").await?;
    let ext = std::path::Path::new(&p.nome_arquivo).extension().and_then(|e| e.to_str()).unwrap_or("bin").to_lowercase();
    let tipo_conteudo = crate::armazenamento::tipo_por_extensao(&ext);
    if let Some(d) = garantir_lista(&mut docs, "documentos").iter_mut().find(|d| d.get("sha256").and_then(Value::as_str) == Some(p.sha256.as_str())) {
        // Já importado (por exemplo, antes do sistema online): só guarda o original para consulta.
        let guardado = arm.guardar_original(&p.sha256, &p.nome_arquivo, tipo_conteudo, bytes).await?;
        let doc_id = d.get("id").and_then(Value::as_str).unwrap_or("doc").to_string();
        if d.get("original").is_none() {
            d["original"] = json!(format!("originais/{}", p.sha256));
            docs["atualizado_em"] = json!(agora);
            arm.gravar_valor("documentos", &docs).await?;
        }
        return Ok(Resultado {
            documento_id: doc_id,
            holerite: false,
            movimentacoes_gravadas: 0,
            movimentacoes_ignoradas: p.dados.movimentacoes.len(),
            saldo_divida: false,
            original_guardado: guardado,
            so_original: true,
        });
    }
    let x = &p.dados;
    let doc_id = x.documento.get("id").and_then(Value::as_str).unwrap_or("doc").to_string();
    let mut res = Resultado {
        documento_id: doc_id.clone(),
        holerite: false,
        movimentacoes_gravadas: 0,
        movimentacoes_ignoradas: 0,
        saldo_divida: false,
        original_guardado: false,
        so_original: false,
    };

    if let Some(h) = &x.holerite {
        let mut hol = arm.ler_json("holerites").await?;
        let l = garantir_lista(&mut hol, "holerites");
        l.retain(|e| e.get("id") != h.get("id"));
        l.push(h.clone());
        l.sort_by(|a, b| a["competencia"].as_str().cmp(&b["competencia"].as_str()));
        hol["atualizado_em"] = json!(agora);
        arm.gravar_valor("holerites", &hol).await?;
        res.holerite = true;
    }

    if !x.movimentacoes.is_empty() || !x.saldos.is_empty() {
        let mut movs = arm.ler_json("movimentacoes").await?;
        let cats = arm.ler_json("categorias").await?;
        // A prévia pode ser de antes de migrar: traduz de novo com os grupos de agora.
        let grupos = classificar::Classificador::novo(&Value::Null).com_grupos(&cats);
        let existentes: HashSet<String> =
            lista(&movs, "movimentacoes").iter().filter_map(|m| m.get("hash").and_then(Value::as_str).map(String::from)).collect();
        let ids: HashSet<String> = lista(&movs, "movimentacoes").iter().filter_map(|m| m.get("id").and_then(Value::as_str).map(String::from)).collect();
        let ignorar: HashSet<&str> = ajustes.ignorar.iter().map(String::as_str).collect();
        let mut novas = Vec::new();
        for m in &x.movimentacoes {
            let id = m["id"].as_str().unwrap_or_default();
            let hash = m["hash"].as_str().unwrap_or_default();
            if ignorar.contains(id) || existentes.contains(hash) || ids.contains(id) {
                res.movimentacoes_ignoradas += 1;
                continue;
            }
            let mut m = m.clone();
            if let Some(obj) = m.as_object_mut() {
                obj.remove("duplicada");
            }
            grupos.finalizar(&mut m);
            if let Some(cat) = ajustes.categorias.get(id) {
                let natureza = m["natureza"].as_str().unwrap_or("");
                let serve = crate::categorias::existe(&cats, cat) && crate::categorias::conferir_tipo(&cats, cat, natureza).is_ok();
                if serve && m["categoria"].as_str() != Some(cat) {
                    m["categoria"] = json!(cat);
                    m["subcategoria"] = Value::Null;
                    m["classificacao"] = json!("manual");
                }
            }
            novas.push(m);
        }
        res.movimentacoes_gravadas = novas.len();
        garantir_lista(&mut movs, "movimentacoes").extend(novas);
        let saldos = garantir_lista(&mut movs, "saldos");
        for s in &x.saldos {
            saldos.retain(|e| !(e["conta_id"] == s["conta_id"] && e["competencia"] == s["competencia"]));
            saldos.push(s.clone());
        }
        movs["atualizado_em"] = json!(agora);
        arm.gravar_valor("movimentacoes", &movs).await?;
    }

    if let Some(c) = &x.conta {
        let mut cfg = arm.ler_json("config").await?;
        let contas = garantir_lista(&mut cfg, "contas");
        if !contas.iter().any(|e| e.get("id") == c.get("id")) {
            contas.push(c.clone());
            cfg["atualizado_em"] = json!(agora);
            arm.gravar_valor("config", &cfg).await?;
        }
    }

    if let (Some(div), Some(saldo)) = (&x.divida, &x.divida_saldo) {
        let mut dv = arm.ler_json("dividas").await?;
        let l = garantir_lista(&mut dv, "dividas");
        let pos = match l.iter().position(|e| e.get("id") == div.get("id")) {
            Some(i) => i,
            None => {
                l.push(div.clone());
                l.len() - 1
            }
        };
        let d = &mut l[pos];
        if !d.get("saldos").is_some_and(Value::is_array) {
            d["saldos"] = json!([]);
        }
        let saldos = d["saldos"].as_array_mut().unwrap();
        saldos.retain(|s| s.get("data") != saldo.get("data"));
        saldos.push(saldo.clone());
        saldos.sort_by(|a, b| a["data"].as_str().cmp(&b["data"].as_str()));
        dv["atualizado_em"] = json!(agora);
        arm.gravar_valor("dividas", &dv).await?;
        res.saldo_divida = true;
    }

    res.original_guardado = arm.guardar_original(&p.sha256, &p.nome_arquivo, tipo_conteudo, bytes).await?;

    let mut entrada = x.documento.clone();
    entrada["nome_original"] = json!(p.nome_arquivo);
    entrada["sha256"] = json!(p.sha256);
    entrada["original"] = json!(format!("originais/{}", p.sha256));
    entrada["processado_em"] = json!(agora);
    entrada["registros_gerados"] = json!({
        "holerites": if res.holerite { 1 } else { 0 },
        "movimentacoes": res.movimentacoes_gravadas,
    });
    garantir_lista(&mut docs, "documentos").push(entrada);
    docs["atualizado_em"] = json!(agora);
    arm.gravar_valor("documentos", &docs).await?;
    Ok(res)
}

/// "dd/mm/aaaa" → "aaaa-mm-dd"
pub fn data_br(s: &str) -> Option<String> {
    let p: Vec<&str> = s.trim().split('/').collect();
    if p.len() != 3 {
        return None;
    }
    let (d, m, a) = (p[0].parse::<u32>().ok()?, p[1].parse::<u32>().ok()?, p[2]);
    let a: i32 = match a.len() {
        4 => a.parse().ok()?,
        2 => 2000 + a.parse::<i32>().ok()?,
        _ => return None,
    };
    chrono::NaiveDate::from_ymd_opt(a, m, d).map(|x| x.format("%Y-%m-%d").to_string())
}

pub fn brl(v: f64) -> String {
    let neg = v < 0.0;
    let c = (v.abs() * 100.0).round() as i64;
    let int = (c / 100).to_string();
    let mut com_pontos = String::new();
    for (i, ch) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            com_pontos.push('.');
        }
        com_pontos.push(ch);
    }
    format!("{}R$ {},{:02}", if neg { "−" } else { "" }, com_pontos, c % 100)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn datas_e_valores() {
        assert_eq!(data_br("04/09/2026").as_deref(), Some("2026-09-04"));
        assert_eq!(data_br("30/09/26").as_deref(), Some("2026-09-30"));
        assert_eq!(data_br("31/02/2026"), None);
        assert_eq!(brl(2345.67), "R$ 2.345,67");
        assert_eq!(brl(-53.3), "−R$ 53,30");
        assert_eq!(brl(1234567.0), "R$ 1.234.567,00");
    }

    #[test]
    fn hash_igual_ao_das_importacoes_anteriores() {
        // Mesma fórmula do script Python que importou as faturas de jul–set/2026.
        let h = hash_mov("cartao-exemplo", "2026-09-04", -84.7, "RESTAURANTE EXEMPLO", "", "2026-09");
        assert_eq!(h.len(), 16);
    }
}

/// Confere os leitores contra documentos e dados reais, que ficam fora do repositório:
/// `FINANCEIRO_TESTE_DOCS=pasta/com/pdfs FINANCEIRO_TESTE_DADOS=pasta/dados cargo test -- --ignored`
#[cfg(test)]
mod conferencia_real {
    use super::*;

    fn pdfs(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                pdfs(&p, out);
            } else if p.extension().is_some_and(|x| x == "pdf") {
                out.push(p);
            }
        }
    }

    #[tokio::test]
    #[ignore]
    async fn documentos_reais_reproduzem_os_dados_gravados() {
        let (Ok(docs), Ok(dados)) = (std::env::var("FINANCEIRO_TESTE_DOCS"), std::env::var("FINANCEIRO_TESTE_DADOS")) else {
            panic!("defina FINANCEIRO_TESTE_DOCS e FINANCEIRO_TESTE_DADOS");
        };
        let arm = Armazenamento::Pasta(dados.into());
        let movs = arm.ler_json("movimentacoes").await.unwrap();
        let hol = arm.ler_json("holerites").await.unwrap();
        let por_hash: HashMap<&str, &Value> = lista(&movs, "movimentacoes").iter().filter_map(|m| Some((m["hash"].as_str()?, m))).collect();
        let mut arquivos = vec![];
        pdfs(std::path::Path::new(&docs), &mut arquivos);
        arquivos.sort();
        assert!(!arquivos.is_empty());
        for a in arquivos {
            let bytes = std::fs::read(&a).unwrap();
            let p = analisar(&arm, "t".into(), a.file_name().unwrap().to_str().unwrap(), &bytes).await.unwrap_or_else(|e| panic!("{}: {e:#}", a.display()));
            println!("{} → {:?} · já importado: {}", a.display(), p.tipo, p.ja_importado);
            for c in &p.dados.conferencias {
                println!("   {} {}: doc {} calc {}", if c.ok { "ok" } else { "DIVERGE" }, c.descricao, c.no_documento, c.calculado);
                assert!(c.ok);
            }
            if let Some(h) = &p.dados.holerite {
                let gravado = lista(&hol, "holerites").iter().find(|x| x["competencia"] == h["competencia"]).expect("holerite gravado");
                for campo in ["bruto", "total_descontos", "liquido", "liquido_competencia", "fgts", "base_inss", "base_irrf"] {
                    assert_eq!(h[campo].as_f64(), gravado[campo].as_f64(), "{campo} em {}", h["competencia"]);
                }
                let tipos = |x: &Value| x["descontos"].as_array().unwrap().iter().map(|d| (d["tipo"].as_str().unwrap_or("").to_string(), d["valor"].as_f64().unwrap())).collect::<Vec<_>>();
                assert_eq!(tipos(h), tipos(gravado));
            }
            let mut difs = 0;
            for m in &p.dados.movimentacoes {
                let h = m["hash"].as_str().unwrap();
                match por_hash.get(h) {
                    None => {
                        println!("   NOVO {}", m);
                        difs += 1;
                    }
                    Some(g) => {
                        for campo in ["data", "valor", "natureza", "competencia", "parcela", "data_compra"] {
                            assert_eq!(m.get(campo), g.get(campo), "{campo} de {h}");
                        }
                        if m["categoria"] != g["categoria"] {
                            println!("   categoria {}: agora {} · gravada {}", m["descricao"], m["categoria"], g["categoria"]);
                        }
                    }
                }
            }
            assert_eq!(difs, 0, "lançamentos que não batem com os gravados");
            println!("   {} lançamentos, todos já gravados", p.dados.movimentacoes.len());
        }
    }
}
