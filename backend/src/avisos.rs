//! Regras dos avisos no celular: decide, depois de cada sincronização, o que vale avisar.
//! Função pura: recebe os arquivos já lidos e a data de hoje, devolve o que enviar.

use chrono::{Datelike, Duration, NaiveDate};
use serde_json::{json, Value};

pub struct Aviso {
    /// Chave(s) a gravar em `enviados`; avisos agrupados cobrem várias.
    pub chaves: Vec<String>,
    pub tipo: &'static str,
    pub titulo: String,
    pub texto: String,
    pub link: String,
}

pub struct Entrada<'a> {
    pub fixas: &'a Value,
    pub movs: &'a Value,
    pub categorias: &'a Value,
    pub sincronizacoes: &'a Value,
    pub avisos: &'a Value,
    /// Limites de gasto por categoria (`orcamentos.json`).
    pub orcamentos: &'a Value,
}

pub struct Resultado {
    pub enviar: Vec<Aviso>,
    /// Chaves a gravar em `enviados` sem enviar (primeira verificação).
    pub semente: Vec<String>,
    /// Novo `avisos.cartoes`.
    pub cartoes: Value,
}

pub fn ultimo_dia(ano: i32, mes: u32) -> u32 {
    let (a, m) = if mes >= 12 { (ano + 1, 1) } else { (ano, mes + 1) };
    NaiveDate::from_ymd_opt(a, m, 1).and_then(|d| d.pred_opt()).map_or(28, |d| d.day())
}

const MESES: [&str; 12] = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

fn txt<'a>(v: &'a Value, campo: &str) -> &'a str {
    v[campo].as_str().unwrap_or("")
}

fn data_de(v: &Value) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(v.as_str()?.get(..10)?, "%Y-%m-%d").ok()
}

fn dd_mm(d: NaiveDate) -> String {
    d.format("%d/%m").to_string()
}

fn mes_de(d: NaiveDate) -> String {
    d.format("%Y-%m").to_string()
}

/// "A, B e C"
fn lista_com_e(nomes: &[String]) -> String {
    match nomes.split_last() {
        Some((ultimo, resto)) if !resto.is_empty() => format!("{} e {}", resto.join(", "), ultimo),
        Some((ultimo, _)) => ultimo.clone(),
        None => String::new(),
    }
}

const MAX_NA_LISTA: usize = 5;

/// Como `lista_com_e`, mas com no máximo 5 itens: "A, B, C, D, E e mais 3".
fn lista_limitada(nomes: &[String]) -> String {
    if nomes.len() <= MAX_NA_LISTA {
        return lista_com_e(nomes);
    }
    format!("{} e mais {}", nomes[..MAX_NA_LISTA].join(", "), nomes.len() - MAX_NA_LISTA)
}

/// Um aviso agrupado cobre várias chaves.
fn agrupado(tipo: &'static str, itens: &[(String, String, f64)], titulo_um: impl Fn(&str) -> String, titulo_varios: &str, texto: impl Fn(&[(String, String, f64)]) -> String) -> Aviso {
    let chaves = itens.iter().map(|i| i.0.clone()).collect::<Vec<_>>();
    let titulo = if itens.len() == 1 { titulo_um(&itens[0].1) } else { titulo_varios.to_string() };
    Aviso { chaves, tipo, titulo, texto: texto(itens), link: "#fixas".into() }
}

struct Ciclo {
    conta_id: String,
    instituicao: String,
    fechamento: NaiveDate,
    vencimento: NaiveDate,
}

/// Soma da fatura do mês (mês do vencimento) deste cartão, sem os pagamentos de fatura.
fn valor_fatura(movs: &[Value], conta_id: &str, venc: NaiveDate) -> f64 {
    let mes = mes_de(venc);
    movs.iter()
        .filter(|m| txt(m, "conta_id") == conta_id && txt(m, "categoria") != "pagamento_fatura_cartao" && crate::fixas::competencia(m) == mes)
        .filter_map(|m| m["valor"].as_f64())
        .map(|v| -v)
        .sum::<f64>()
}

fn fatura_paga(movs: &[Value], fechamento: NaiveDate, valor: f64) -> bool {
    movs.iter().any(|m| {
        txt(m, "categoria") == "pagamento_fatura_cartao"
            && data_de(&m["data"]).is_some_and(|d| d >= fechamento)
            && m["valor"].as_f64().is_some_and(|v| v.abs() >= valor * 0.9 && v.abs() <= valor * 1.1)
    })
}

pub fn verificar(e: &Entrada, hoje: NaiveDate) -> Resultado {
    let movs: Vec<Value> = e.movs["movimentacoes"].as_array().cloned().unwrap_or_default();
    let fixas: Vec<Value> = e.fixas["fixas"].as_array().cloned().unwrap_or_default();
    let ignoradas: Vec<String> = e.fixas["ignoradas"].as_array().map(|l| l.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    // Cada item é `{ "chave", "em" }`; texto puro também vale.
    let enviados: Vec<&str> = e.avisos["enviados"].as_array().map(|l| l.iter().filter_map(|x| x.as_str().or_else(|| x["chave"].as_str())).collect()).unwrap_or_default();
    let primeira = !e.avisos["enviados"].is_array();
    let ligado = |tipo: &str| e.avisos["tipos"][tipo].as_bool() != Some(false);
    // Tipos desligados também são calculados: o que teriam avisado entra na semente, para não
    // disparar um lote antigo quando forem ligados de novo.
    let mut candidatos: Vec<Aviso> = Vec::new();
    let mut vazios: Vec<String> = Vec::new();

    // Contas fixas que vencem amanhã e ainda não foram pagas.
    {
        let amanha = hoje + Duration::days(1);
        let mes = mes_de(amanha);
        let itens: Vec<(String, String, f64)> = fixas
            .iter()
            .filter(|f| f["ativa"].as_bool().unwrap_or(true))
            .filter_map(|f| {
                let dia = f["dia"].as_u64()? as u32;
                let venc = dia.min(ultimo_dia(amanha.year(), amanha.month()));
                (venc == amanha.day() && !crate::fixas::paga_no_mes(f, &movs, &mes)).then(|| (format!("fixa:{}:{}", txt(f, "id"), mes), txt(f, "nome").to_string(), f["valor"].as_f64().unwrap_or(0.0)))
            })
            .filter(|i| !enviados.contains(&i.0.as_str()))
            .collect();
        if !itens.is_empty() {
            let a = agrupado(
                "fixa_vencendo",
                &itens,
                |n| format!("{n} vence amanhã"),
                "Contas vencem amanhã",
                |l| {
                    let total: f64 = l.iter().map(|i| i.2).sum();
                    if l.len() == 1 {
                        crate::importar::brl(total)
                    } else {
                        format!("{}: {}", lista_limitada(&l.iter().map(|i| i.1.clone()).collect::<Vec<_>>()), crate::importar::brl(total))
                    }
                },
            );
            candidatos.push(a);
        }
    }

    // Cobranças novas que parecem assinatura.
    {
        let grupos = crate::categorias::grupos(e.categorias);
        let itens: Vec<(String, String, f64)> = crate::fixas::sugestoes(&movs, &fixas, &mes_de(hoje), &ignoradas, &grupos)
            .into_iter()
            .map(|s| (format!("assinatura:{}", s.chave), s.nome, s.valor))
            .filter(|i| !enviados.contains(&i.0.as_str()))
            .collect();
        if !itens.is_empty() {
            candidatos.push(agrupado("assinatura_nova", &itens, |_| "Cobrança que parece assinatura".into(), "Cobranças que parecem assinatura", |l| {
                lista_limitada(&l.iter().map(|i| format!("{} ({})", i.1, crate::importar::brl(i.2))).collect::<Vec<_>>())
            }));
        }
    }

    // Cartões: pela última sincronização que deu certo.
    let mut faturas: Vec<Aviso> = Vec::new();
    let mut cartoes = e.avisos["cartoes"].clone();
    if !cartoes.is_object() {
        cartoes = json!({});
    }
    let ultima_ok = e.sincronizacoes["execucoes"].as_array().and_then(|l| l.iter().rev().find(|x| x["ok"].as_bool() == Some(true)));
    if let Some(exec) = ultima_ok {
        for conta in exec["contas"].as_array().map(|l| l.as_slice()).unwrap_or_default() {
            if txt(conta, "tipo") != "cartao" {
                continue;
            }
            let (Some(nova_f), Some(nova_v)) = (data_de(&conta["fechamento"]), data_de(&conta["vencimento"])) else { continue };
            let id = txt(conta, "conta_id").to_string();
            let guardada = data_de(&cartoes[&id]["fechamento"]).zip(data_de(&cartoes[&id]["vencimento"]));
            let anterior = data_de(&cartoes[&id]["fechada"]["fechamento"]).zip(data_de(&cartoes[&id]["fechada"]["vencimento"]));
            // A data do cartão avança sozinha: se pulou, a fatura que fechou foi a guardada.
            // O último ciclo fechado fica guardado em `fechada` e só muda quando o próximo ciclo fecha.
            let fechada = match guardada {
                Some((gf, gv)) if gf <= hoje && gf != nova_f => Some((gf, gv)),
                _ if nova_f <= hoje => Some((nova_f, nova_v)),
                _ => anterior,
            };
            cartoes[&id] = json!({ "fechamento": nova_f.to_string(), "vencimento": nova_v.to_string() });
            if let Some((f, v)) = fechada {
                cartoes[&id]["fechada"] = json!({ "fechamento": f.to_string(), "vencimento": v.to_string() });
            }
            let Some(ciclo) = fechada else { continue };
            let c = Ciclo { conta_id: id, instituicao: txt(conta, "instituicao").to_string(), fechamento: ciclo.0, vencimento: ciclo.1 };
            if c.fechamento > hoje {
                continue;
            }
            let valor = valor_fatura(&movs, &c.conta_id, c.vencimento);
            let dias_fechada = (hoje - c.fechamento).num_days();
            let chave = format!("fatura-fechou:{}:{}", c.conta_id, c.fechamento);
            if dias_fechada <= 3 && !enviados.contains(&chave.as_str()) {
                let texto = if valor > 0.0 {
                    format!("Fatura do {} fechou: {}. Vence em {}", c.instituicao, crate::importar::brl(valor), dd_mm(c.vencimento))
                } else {
                    format!("Fatura do {} fechou. Vence em {}", c.instituicao, dd_mm(c.vencimento))
                };
                faturas.push(Aviso { chaves: vec![chave], tipo: "fatura", titulo: "Fatura fechou".into(), texto, link: "#dividas".into() });
            }
            let falta = (c.vencimento - hoje).num_days();
            let chave = format!("fatura-vence:{}:{}", c.conta_id, c.vencimento);
            if (0..=2).contains(&falta) && valor > 0.0 && !fatura_paga(&movs, c.fechamento, valor) && !enviados.contains(&chave.as_str()) {
                let quando = match falta {
                    0 => "vence hoje".to_string(),
                    1 => "vence amanhã".to_string(),
                    n => format!("vence em {n} dias"),
                };
                faturas.push(Aviso {
                    chaves: vec![chave],
                    tipo: "fatura",
                    titulo: "Fatura perto de vencer".into(),
                    texto: format!("Fatura do {} {}: {}", c.instituicao, quando, crate::importar::brl(valor)),
                    link: "#dividas".into(),
                });
            }
        }
    }
    // No máximo um aviso por tipo.
    if faturas.len() > 1 {
        let texto = faturas.iter().map(|a| a.texto.as_str()).collect::<Vec<_>>().join(" · ");
        let chaves = faturas.iter().flat_map(|a| a.chaves.clone()).collect();
        candidatos.push(Aviso { chaves, tipo: "fatura", titulo: "Faturas do cartão".into(), texto, link: "#dividas".into() });
    } else {
        candidatos.append(&mut faturas);
    }

    // Limite de gasto por categoria: um aviso ao passar de 80% e outro ao passar do limite, no mês.
    {
        let mes = mes_de(hoje);
        let gasto = crate::orcamentos::gasto_por_categoria(&movs, &mes);
        let fonte = if crate::categorias::migrado(e.categorias) { crate::categorias::grupos(e.categorias) } else { crate::categorias::todas(e.categorias) };
        let nome = |id: &str| fonte.iter().find(|c| c["id"].as_str() == Some(id)).and_then(|c| c["nome"].as_str()).unwrap_or(id).to_string();
        let mut itens: Vec<(Vec<String>, String)> = Vec::new();
        for l in crate::orcamentos::lista(e.orcamentos) {
            let (Some(cat), Some(limite)) = (l["categoria"].as_str(), l["limite"].as_f64()) else { continue };
            if limite <= 0.0 {
                continue;
            }
            let g = gasto.get(cat).copied().unwrap_or(0.0);
            let c80 = format!("orcamento:{cat}:{mes}:80");
            let c100 = format!("orcamento:{cat}:{mes}:100");
            if g > limite + 0.004 && !enviados.contains(&c100.as_str()) {
                // Passou: cobre também o de 80%, para não chegar depois.
                itens.push((vec![c80, c100], format!("{} passou do limite: {} de {}", nome(cat), crate::importar::brl(g), crate::importar::brl(limite))));
            } else if g >= limite * 0.8 && g <= limite + 0.004 && !enviados.contains(&c80.as_str()) {
                itens.push((vec![c80], format!("{} já usou {}% do limite: {} de {}", nome(cat), ((g / limite) * 100.0).round() as i64, crate::importar::brl(g), crate::importar::brl(limite))));
            }
        }
        if !itens.is_empty() {
            let titulo = if itens.len() == 1 { "Limite de gasto".to_string() } else { "Limites de gasto".to_string() };
            candidatos.push(Aviso {
                chaves: itens.iter().flat_map(|i| i.0.clone()).collect(),
                tipo: "orcamento",
                titulo,
                texto: itens.iter().map(|i| i.1.as_str()).collect::<Vec<_>>().join(" · "),
                link: "#inicio".into(),
            });
        }
    }

    // Resumo do mês anterior.
    {
        let anterior = hoje.with_day(1).and_then(|d| d.pred_opt()).unwrap_or(hoje);
        let mes = mes_de(anterior);
        let chave = format!("fechamento:{mes}");
        let tem_lancamento = movs.iter().any(|m| crate::fixas::competencia(m) == mes);
        if !enviados.contains(&chave.as_str()) && !tem_lancamento {
            // Mês anterior vazio: nada a resumir; marca como visto para não tentar de novo.
            vazios.push(chave);
        } else if !enviados.contains(&chave.as_str()) {
            candidatos.push(Aviso {
                chaves: vec![chave],
                tipo: "fechamento_mes",
                titulo: format!("Resumo de {} pronto", MESES[anterior.month0() as usize]),
                texto: "Toque para ver quanto sobrou no mês.".into(),
                link: format!("#fechamento/{mes}"),
            });
        }
    }

    let (ligados, desligados): (Vec<Aviso>, Vec<Aviso>) = candidatos.into_iter().partition(|a| ligado(a.tipo));
    let mut semente: Vec<String> = desligados.iter().flat_map(|a| a.chaves.clone()).collect();
    semente.extend(vazios);
    if primeira {
        semente.extend(ligados.iter().flat_map(|a| a.chaves.clone()));
        Resultado { enviar: vec![], semente, cartoes }
    } else {
        Resultado { enviar: ligados, semente, cartoes }
    }
}

// ---------- arquivo `avisos`, aparelhos e envio ----------

pub const TIPOS: [&str; 5] = ["fixa_vencendo", "assinatura_nova", "fatura", "fechamento_mes", "orcamento"];
const DIAS_GUARDADOS: i64 = 120;
const FALHAS_PARA_REMOVER: u64 = 5;

/// Identificador estável do aparelho: 16 primeiros hex do sha256 do endpoint.
pub fn id_do_aparelho(endpoint: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(endpoint.as_bytes()))[..16].to_string()
}

/// Garante o formato do arquivo (objeto, `chaves` VAPID, `aparelhos`, `tipos`). Devolve se mudou algo.
pub fn garantir_formato(avisos: &mut Value) -> bool {
    let antes = avisos.clone();
    if !avisos.is_object() {
        *avisos = json!({});
    }
    if avisos["schema_version"].is_null() {
        avisos["schema_version"] = json!(1);
    }
    if !(avisos["chaves"]["publica"].is_string() && avisos["chaves"]["privada"].is_string()) {
        let c = crate::push::gerar_chaves();
        avisos["chaves"] = json!({ "publica": c.publica, "privada": c.privada });
    }
    if !avisos["aparelhos"].is_array() {
        avisos["aparelhos"] = json!([]);
    }
    if !avisos["tipos"].is_object() {
        avisos["tipos"] = json!({});
    }
    for t in TIPOS {
        if !avisos["tipos"][t].is_boolean() {
            avisos["tipos"][t] = json!(true);
        }
    }
    *avisos != antes
}

pub fn chaves_vapid(avisos: &Value) -> Option<crate::push::Chaves> {
    Some(crate::push::Chaves { publica: avisos["chaves"]["publica"].as_str()?.to_string(), privada: avisos["chaves"]["privada"].as_str()?.to_string() })
}

/// Contato exigido pelo VAPID.
pub fn assunto_vapid() -> String {
    let var = |n: &str| std::env::var(n).unwrap_or_default().trim().to_string();
    match (var("FINANCEIRO_VAPID_ASSUNTO"), var("FINANCEIRO_EMAIL")) {
        (a, _) if !a.is_empty() => a,
        (_, e) if !e.is_empty() => format!("mailto:{e}"),
        _ => "mailto:financeiro@localhost".to_string(),
    }
}

/// Grava as chaves em `enviados` (uma vez cada) e apaga as de mais de 120 dias.
pub fn registrar_chaves(avisos: &mut Value, chaves: &[String], agora: &str, hoje: NaiveDate) {
    if !avisos.is_object() {
        *avisos = json!({});
    }
    let mut lista = avisos["enviados"].as_array().cloned().unwrap_or_default();
    let limite = hoje - Duration::days(DIAS_GUARDADOS);
    lista.retain(|x| data_de(&x["em"]).map_or(true, |d| d >= limite));
    for c in chaves {
        let ja = lista.iter().any(|x| x.as_str().or_else(|| x["chave"].as_str()) == Some(c.as_str()));
        if !ja {
            lista.push(json!({ "chave": c, "em": agora }));
        }
    }
    avisos["enviados"] = Value::Array(lista);
}

/// Aplica o resultado das entregas aos aparelhos, uma decisão por aparelho em cada rodada:
/// qualquer entregue zera as falhas e anota o envio; senão, qualquer expirado remove;
/// senão soma uma falha (5 seguidas removem).
pub fn aplicar_entregas(avisos: &mut Value, resultados: &[(String, crate::push::Entrega)], agora: &str) {
    use crate::push::Entrega;
    let Some(lista) = avisos["aparelhos"].as_array_mut() else { return };
    let mut ids: Vec<&String> = resultados.iter().map(|r| &r.0).collect();
    ids.sort();
    ids.dedup();
    for id in ids {
        let Some(pos) = lista.iter().position(|a| a["id"].as_str() == Some(id.as_str())) else { continue };
        let seus: Vec<&Entrega> = resultados.iter().filter(|r| &r.0 == id).map(|r| &r.1).collect();
        if seus.iter().any(|e| matches!(e, Entrega::Entregue)) {
            lista[pos]["falhas"] = json!(0);
            lista[pos]["ultimo_envio"] = json!(agora);
        } else if seus.iter().any(|e| matches!(e, Entrega::Expirado)) {
            lista.remove(pos);
        } else {
            let n = lista[pos]["falhas"].as_u64().unwrap_or(0) + 1;
            if n >= FALHAS_PARA_REMOVER {
                lista.remove(pos);
            } else {
                lista[pos]["falhas"] = json!(n);
            }
        }
    }
}

/// Conteúdo cifrado que o service worker lê; `tipo` vira a `tag` da notificação.
pub fn mensagem(a: &Aviso) -> Value {
    json!({ "tipo": a.tipo, "titulo": a.titulo, "texto": a.texto, "link": a.link })
}

pub fn mensagem_de_teste() -> Value {
    json!({ "tipo": "teste", "titulo": "Financeiro", "texto": "Avisos ligados neste aparelho.", "link": "#ajustes" })
}

/// `p256dh` = ponto P-256 de 65 bytes; `auth` = 16 bytes (ambos base64url).
pub fn validar_assinatura(p256dh: &str, auth: &str) -> Result<(), &'static str> {
    use base64::Engine;
    let de = |t: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(t.trim_end_matches('=')).ok();
    if de(p256dh).map_or(true, |b| b.len() != 65) {
        return Err("chave p256dh inválida (esperado ponto P-256 de 65 bytes em base64url)");
    }
    if de(auth).map_or(true, |b| b.len() != 16) {
        return Err("chave auth inválida (esperado 16 bytes em base64url)");
    }
    Ok(())
}

/// Envia cada mensagem a cada aparelho. Sem rede nem I/O além do envio; não registra endpoint nem conteúdo.
pub async fn enviar_para(http: &reqwest::Client, chaves: &crate::push::Chaves, aparelhos: &[Value], mensagens: &[Value]) -> Vec<(String, crate::push::Entrega)> {
    let assunto = assunto_vapid();
    let mut out = Vec::new();
    for m in mensagens {
        for a in aparelhos {
            let id = a["id"].as_str().unwrap_or("").to_string();
            let e = crate::push::enviar(http, chaves, &assunto, a["endpoint"].as_str().unwrap_or(""), a["p256dh"].as_str().unwrap_or(""), a["auth"].as_str().unwrap_or(""), m).await;
            out.push((id, e));
        }
    }
    out
}

#[cfg(test)]
mod testes {
    use super::*;

    fn env(chave: &str) -> Value {
        json!({ "chave": chave, "em": "2026-11-01T08:00:00-03:00" })
    }

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    struct Cen {
        fixas: Value,
        movs: Value,
        categorias: Value,
        sinc: Value,
        avisos: Value,
        orcamentos: Value,
    }

    fn cen() -> Cen {
        Cen {
            fixas: json!({ "fixas": [], "ignoradas": [] }),
            movs: json!({ "movimentacoes": [] }),
            categorias: json!({}),
            sinc: json!({ "execucoes": [] }),
            avisos: json!({ "enviados": [] }),
            orcamentos: json!({}),
        }
    }

    fn rodar(c: &Cen, hoje: &str) -> Resultado {
        verificar(&Entrada { fixas: &c.fixas, movs: &c.movs, categorias: &c.categorias, sincronizacoes: &c.sinc, avisos: &c.avisos, orcamentos: &c.orcamentos }, d(hoje))
    }

    fn so(r: &Resultado, tipo: &str) -> Vec<(String, String, String)> {
        r.enviar.iter().filter(|a| a.tipo == tipo).map(|a| (a.chaves.join("|"), a.titulo.clone(), a.texto.clone())).collect()
    }

    fn fixa(id: &str, nome: &str, valor: f64, dia: u32) -> Value {
        json!({ "id": id, "nome": nome, "valor": valor, "dia": dia, "ativa": true, "pagos": [], "busca": "" })
    }

    fn com_fixas(c: &mut Cen, l: Vec<Value>) {
        c.fixas = json!({ "fixas": l, "ignoradas": [] });
    }

    // Já avisou o resumo de outubro: assim os testes não misturam com o fechamento do mês.
    fn base(c: &mut Cen, hoje_mes_ant: &str) {
        c.avisos = json!({ "enviados": [env(&format!("fechamento:{hoje_mes_ant}"))] });
    }

    fn cartao_sinc(fech: &str, venc: &str) -> Value {
        json!({ "execucoes": [{ "em": "2026-11-11T08:00:00-03:00", "ok": true, "contas": [
            { "conta": "Nubank", "conta_id": "c1", "instituicao": "Nubank", "tipo": "cartao", "saldo": 0, "vencimento": venc, "fechamento": fech },
            { "conta": "Corrente", "conta_id": "cc", "instituicao": "Banco", "tipo": "corrente", "saldo": 10 }
        ] }] })
    }

    fn compra(id: &str, valor: f64, comp: &str) -> Value {
        json!({ "id": id, "data": "2026-10-20", "valor": valor, "descricao": "LOJA", "conta_id": "c1", "competencia": comp, "natureza": "despesa", "categoria": "outros" })
    }

    #[test]
    fn primeira_vez_so_semente() {
        let mut c = cen();
        com_fixas(&mut c, vec![fixa("a", "Netflix", 55.9, 20)]);
        c.avisos = json!({});
        let r = rodar(&c, "2026-11-19");
        assert!(r.enviar.is_empty());
        assert!(r.semente.contains(&"fixa:a:2026-11".to_string()));
        assert!(r.semente.contains(&"fechamento:2026-10".to_string()));
    }

    #[test]
    fn fixa_vence_amanha_nao_paga() {
        let mut c = cen();
        base(&mut c, "2026-10");
        com_fixas(&mut c, vec![fixa("a", "Netflix", 55.9, 20)]);
        let r = rodar(&c, "2026-11-19");
        assert_eq!(so(&r, "fixa_vencendo"), vec![("fixa:a:2026-11".into(), "Netflix vence amanhã".into(), "R$ 55,90".into())]);
        assert_eq!(r.enviar[0].link, "#fixas");
    }

    #[test]
    fn fixa_paga_nao_avisa() {
        let mut c = cen();
        base(&mut c, "2026-10");
        let mut f = fixa("a", "Netflix", 55.9, 20);
        f["pagos"] = json!(["2026-11"]);
        com_fixas(&mut c, vec![f]);
        assert!(so(&rodar(&c, "2026-11-19"), "fixa_vencendo").is_empty());
    }

    #[test]
    fn fixa_dia_31_em_novembro_vence_dia_30() {
        let mut c = cen();
        base(&mut c, "2026-10");
        com_fixas(&mut c, vec![fixa("x", "Aluguel", 1000.0, 31)]);
        assert_eq!(so(&rodar(&c, "2026-11-29"), "fixa_vencendo").len(), 1);
        assert!(so(&rodar(&c, "2026-11-30"), "fixa_vencendo").is_empty());
    }

    #[test]
    fn fixa_dia_1_vespera_no_mes_anterior() {
        let mut c = cen();
        base(&mut c, "2026-10");
        com_fixas(&mut c, vec![fixa("x", "Escola", 500.0, 1)]);
        let r = rodar(&c, "2026-11-30");
        assert_eq!(so(&r, "fixa_vencendo")[0].0, "fixa:x:2026-12");
    }

    #[test]
    fn ja_enviada_nao_repete() {
        let mut c = cen();
        c.avisos = json!({ "enviados": [env("fechamento:2026-10"), env("fixa:a:2026-11")] });
        com_fixas(&mut c, vec![fixa("a", "Netflix", 55.9, 20)]);
        assert!(rodar(&c, "2026-11-19").enviar.is_empty());
    }

    #[test]
    fn varias_fixas_um_aviso_so() {
        let mut c = cen();
        base(&mut c, "2026-10");
        com_fixas(&mut c, vec![fixa("a", "Netflix", 55.9, 20), fixa("b", "Luz", 200.1, 20), fixa("c", "Internet", 56.0, 20), fixa("d", "Outra", 9.0, 25)]);
        let r = rodar(&c, "2026-11-19");
        let v = so(&r, "fixa_vencendo");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].1, "Contas vencem amanhã");
        assert_eq!(v[0].2, "Netflix, Luz e Internet: R$ 312,00");
        assert_eq!(r.enviar[0].chaves, vec!["fixa:a:2026-11", "fixa:b:2026-11", "fixa:c:2026-11"]);
    }

    #[test]
    fn assinatura_nova_e_ignorada() {
        let mut c = cen();
        base(&mut c, "2026-10");
        c.movs = json!({ "movimentacoes": [
            { "id": "1", "data": "2026-11-07", "valor": -21.9, "descricao": "EBN SPOTIFY", "conta_id": "cc", "natureza": "despesa", "categoria": "assinaturas" }
        ] });
        let r = rodar(&c, "2026-11-19");
        let v = so(&r, "assinatura_nova");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].1, "Cobrança que parece assinatura");
        assert_eq!(v[0].2, "Spotify (R$ 21,90)");
        assert_eq!(r.enviar[0].link, "#fixas");
        // Depois de enviada, não repete.
        c.avisos = json!({ "enviados": [env("fechamento:2026-10"), env(&v[0].0)] });
        assert!(rodar(&c, "2026-11-19").enviar.is_empty());
        // Mandada ignorar, nunca avisa.
        c.avisos = json!({ "enviados": [env("fechamento:2026-10")] });
        c.fixas = json!({ "fixas": [], "ignoradas": ["EBN SPOTIFY"] });
        assert!(so(&rodar(&c, "2026-11-19"), "assinatura_nova").is_empty());
    }

    #[test]
    fn fatura_fechou_data_mantida() {
        let mut c = cen();
        base(&mut c, "2026-10");
        c.sinc = cartao_sinc("2026-11-10", "2026-11-20");
        c.avisos = json!({ "enviados": [env("fechamento:2026-10")], "cartoes": { "c1": { "fechamento": "2026-11-10", "vencimento": "2026-11-20" } } });
        c.movs = json!({ "movimentacoes": [compra("1", -100.0, "2026-11"), compra("2", -50.5, "2026-11"), compra("3", -999.0, "2026-12")] });
        let r = rodar(&c, "2026-11-11");
        let v = so(&r, "fatura");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].0, "fatura-fechou:c1:2026-11-10");
        assert_eq!(v[0].2, "Fatura do Nubank fechou: R$ 150,50. Vence em 20/11");
        assert_eq!(r.enviar[0].link, "#dividas");
        assert_eq!(r.cartoes["c1"]["fechamento"], "2026-11-10");
    }

    #[test]
    fn fatura_fechou_data_pulou_para_proximo_ciclo() {
        let mut c = cen();
        base(&mut c, "2026-10");
        c.sinc = cartao_sinc("2026-12-10", "2026-12-20");
        c.avisos = json!({ "enviados": [env("fechamento:2026-10")], "cartoes": { "c1": { "fechamento": "2026-11-10", "vencimento": "2026-11-20" } } });
        c.movs = json!({ "movimentacoes": [compra("1", -100.0, "2026-11"), compra("3", -999.0, "2026-12")] });
        let r = rodar(&c, "2026-11-11");
        let v = so(&r, "fatura");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].0, "fatura-fechou:c1:2026-11-10");
        assert!(v[0].2.contains("R$ 100,00") && v[0].2.contains("20/11"));
        assert_eq!(r.cartoes["c1"]["fechamento"], "2026-12-10");
    }

    #[test]
    fn fatura_fechou_ha_5_dias_nao_avisa() {
        let mut c = cen();
        base(&mut c, "2026-10");
        c.sinc = cartao_sinc("2026-11-10", "2026-11-25");
        c.movs = json!({ "movimentacoes": [compra("1", -100.0, "2026-11")] });
        assert!(so(&rodar(&c, "2026-11-15"), "fatura").is_empty());
    }

    #[test]
    fn fatura_vence_sem_pagamento_avisa() {
        let mut c = cen();
        base(&mut c, "2026-10");
        c.sinc = cartao_sinc("2026-11-10", "2026-11-20");
        c.movs = json!({ "movimentacoes": [compra("1", -300.0, "2026-11")] });
        let r = rodar(&c, "2026-11-18");
        let v = so(&r, "fatura");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].0, "fatura-vence:c1:2026-11-20");
        assert_eq!(v[0].2, "Fatura do Nubank vence em 2 dias: R$ 300,00");
        assert!(so(&rodar(&c, "2026-11-19"), "fatura")[0].2.contains("vence amanhã"));
        assert!(so(&rodar(&c, "2026-11-20"), "fatura")[0].2.contains("vence hoje"));
    }

    #[test]
    fn fatura_vence_paga_nao_avisa() {
        let mut c = cen();
        base(&mut c, "2026-10");
        c.sinc = cartao_sinc("2026-11-10", "2026-11-20");
        c.movs = json!({ "movimentacoes": [
            compra("1", -300.0, "2026-11"),
            { "id": "p", "data": "2026-11-15", "valor": -305.0, "descricao": "PAGAMENTO FATURA", "conta_id": "cc", "natureza": "transferencia_interna", "categoria": "pagamento_fatura_cartao" }
        ] });
        assert!(so(&rodar(&c, "2026-11-18"), "fatura").is_empty());
    }

    #[test]
    fn fatura_sem_sync_ok_nao_avisa() {
        let mut c = cen();
        base(&mut c, "2026-10");
        let mut s = cartao_sinc("2026-11-10", "2026-11-20");
        s["execucoes"][0]["ok"] = json!(false);
        c.sinc = s;
        c.movs = json!({ "movimentacoes": [compra("1", -300.0, "2026-11")] });
        assert!(so(&rodar(&c, "2026-11-11"), "fatura").is_empty());
    }

    #[test]
    fn fechamento_mes_no_dia_1() {
        let mut c = cen();
        c.movs = json!({ "movimentacoes": [compra("1", -10.0, "2026-10"), compra("2", -10.0, "2025-12")] });
        let r = rodar(&c, "2026-11-01");
        assert_eq!(r.enviar.len(), 1);
        let a = &r.enviar[0];
        assert_eq!((a.tipo, a.chaves[0].as_str(), a.titulo.as_str()), ("fechamento_mes", "fechamento:2026-10", "Resumo de outubro pronto"));
        assert_eq!(a.texto, "Toque para ver quanto sobrou no mês.");
        assert_eq!(a.link, "#fechamento/2026-10");
        c.avisos = json!({ "enviados": [env("fechamento:2026-10")] });
        assert!(rodar(&c, "2026-11-01").enviar.is_empty());
        // Em janeiro, o mês anterior é dezembro do ano passado.
        c.avisos = json!({ "enviados": [] });
        assert_eq!(rodar(&c, "2026-01-02").enviar[0].link, "#fechamento/2025-12");
    }

    #[test]
    fn tipo_desligado_vai_para_a_semente() {
        let mut c = cen();
        com_fixas(&mut c, vec![fixa("a", "Netflix", 55.9, 20)]);
        c.avisos = json!({ "enviados": [], "tipos": { "fixa_vencendo": false } });
        let r = rodar(&c, "2026-11-19");
        assert!(so(&r, "fixa_vencendo").is_empty());
        assert!(r.semente.contains(&"fixa:a:2026-11".to_string()));
        // Primeira vez com o tipo desligado também semeia.
        c.avisos = json!({ "tipos": { "fixa_vencendo": false } });
        assert!(rodar(&c, "2026-11-19").semente.contains(&"fixa:a:2026-11".to_string()));
        // Os tipos ligados continuam avisando.
        c.avisos = json!({ "enviados": [], "tipos": { "assinatura_nova": false } });
        assert_eq!(so(&rodar(&c, "2026-11-19"), "fixa_vencendo").len(), 1);
    }

    #[test]
    fn lista_agrupada_limita_a_5_itens() {
        let mut c = cen();
        base(&mut c, "2026-10");
        let fs = (1..=8).map(|i| fixa(&format!("f{i}"), &format!("Conta{i}"), 10.0, 20)).collect();
        com_fixas(&mut c, fs);
        let v = so(&rodar(&c, "2026-11-19"), "fixa_vencendo");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].0.split('|').count(), 8);
        assert!(v[0].2.contains("Conta5 e mais 3: "), "{}", v[0].2);
        assert!(!v[0].2.contains("Conta6"));
    }

    #[test]
    fn fechamento_sem_lancamentos_no_mes_vira_semente() {
        let mut c = cen();
        let r = rodar(&c, "2026-11-01");
        assert!(so(&r, "fechamento_mes").is_empty());
        assert!(r.semente.contains(&"fechamento:2026-10".to_string()));
        c.movs = json!({ "movimentacoes": [compra("1", -10.0, "2026-09")] });
        assert!(so(&rodar(&c, "2026-11-01"), "fechamento_mes").is_empty());
    }

    #[test]
    fn fixa_inativa_nunca_avisa() {
        let mut c = cen();
        base(&mut c, "2026-10");
        let mut f = fixa("a", "Netflix", 55.9, 20);
        f["ativa"] = json!(false);
        com_fixas(&mut c, vec![f]);
        assert!(so(&rodar(&c, "2026-11-19"), "fixa_vencendo").is_empty());
    }

    #[test]
    fn fatura_fechou_janela_de_3_dias() {
        let mut c = cen();
        base(&mut c, "2026-10");
        c.sinc = cartao_sinc("2026-11-10", "2026-11-25");
        c.movs = json!({ "movimentacoes": [compra("1", -100.0, "2026-11")] });
        assert_eq!(so(&rodar(&c, "2026-11-13"), "fatura").len(), 1);
        assert!(so(&rodar(&c, "2026-11-14"), "fatura").is_empty());
    }

    #[test]
    fn fatura_vence_sobrevive_ao_pulo_da_data() {
        let mut c = cen();
        base(&mut c, "2026-10");
        c.sinc = cartao_sinc("2026-12-10", "2026-12-20");
        c.avisos = json!({ "enviados": [env("fechamento:2026-10")], "cartoes": { "c1": { "fechamento": "2026-11-10", "vencimento": "2026-11-20" } } });
        c.movs = json!({ "movimentacoes": [compra("1", -100.0, "2026-11")] });
        let r1 = rodar(&c, "2026-11-11");
        assert_eq!(so(&r1, "fatura").len(), 1);
        c.avisos = json!({ "enviados": [env("fechamento:2026-10"), env("fatura-fechou:c1:2026-11-10")], "cartoes": r1.cartoes });
        let r2 = rodar(&c, "2026-11-18");
        let v = so(&r2, "fatura");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].0, "fatura-vence:c1:2026-11-20");
        assert!(v[0].2.contains("vence em 2 dias"));
    }

    #[test]
    fn duas_faturas_viram_um_aviso() {
        let mut c = cen();
        base(&mut c, "2026-10");
        c.sinc = json!({ "execucoes": [{ "em": "x", "ok": true, "contas": [
            { "conta_id": "c1", "instituicao": "Nubank", "tipo": "cartao", "vencimento": "2026-11-20", "fechamento": "2026-11-10" },
            { "conta_id": "c2", "instituicao": "Itaú", "tipo": "cartao", "vencimento": "2026-11-21", "fechamento": "2026-11-11" }
        ] }] });
        let mut m2 = compra("2", -50.0, "2026-11");
        m2["conta_id"] = json!("c2");
        c.movs = json!({ "movimentacoes": [compra("1", -100.0, "2026-11"), m2] });
        let r = rodar(&c, "2026-11-12");
        assert_eq!(r.enviar.len(), 1);
        let a = &r.enviar[0];
        assert_eq!(a.titulo, "Faturas do cartão");
        assert_eq!(a.link, "#dividas");
        assert_eq!(a.chaves, vec!["fatura-fechou:c1:2026-11-10", "fatura-fechou:c2:2026-11-11"]);
        assert!(a.texto.contains(" · ") && a.texto.contains("Nubank") && a.texto.contains("Itaú"));
    }

    fn ap(id: &str, falhas: u64) -> Value {
        json!({ "id": id, "endpoint": "https://x", "p256dh": "a", "auth": "b", "falhas": falhas })
    }

    fn ids(v: &Value) -> Vec<&str> {
        v["aparelhos"].as_array().unwrap().iter().map(|a| a["id"].as_str().unwrap()).collect()
    }

    #[test]
    fn expirado_remove_aparelho() {
        let mut v = json!({ "aparelhos": [ap("a", 0), ap("b", 0)] });
        aplicar_entregas(&mut v, &[("a".into(), crate::push::Entrega::Expirado)], "2026-11-19T08:00:00-03:00");
        assert_eq!(ids(&v), vec!["b"]);
    }

    #[test]
    fn cinco_falhas_remove() {
        let mut v = json!({ "aparelhos": [ap("a", 3)] });
        aplicar_entregas(&mut v, &[("a".into(), crate::push::Entrega::Falhou("status 500".into()))], "t");
        assert_eq!(v["aparelhos"][0]["falhas"], 4);
        aplicar_entregas(&mut v, &[("a".into(), crate::push::Entrega::Falhou("status 500".into()))], "t");
        assert!(ids(&v).is_empty());
    }

    #[test]
    fn entregue_zera_falhas() {
        let mut v = json!({ "aparelhos": [ap("a", 4)] });
        aplicar_entregas(&mut v, &[("a".into(), crate::push::Entrega::Entregue)], "2026-11-19T08:00:00-03:00");
        assert_eq!(v["aparelhos"][0]["falhas"], 0);
        assert_eq!(v["aparelhos"][0]["ultimo_envio"], "2026-11-19T08:00:00-03:00");
    }

    #[test]
    fn enviados_corta_120_dias() {
        let mut v = json!({ "enviados": [
            { "chave": "velha", "em": "2026-07-01T08:00:00-03:00" },
            { "chave": "recente", "em": "2026-11-01T08:00:00-03:00" } ] });
        registrar_chaves(&mut v, &["nova".into(), "recente".into()], "2026-11-19T08:00:00-03:00", d("2026-11-19"));
        let chaves: Vec<&str> = v["enviados"].as_array().unwrap().iter().map(|x| x["chave"].as_str().unwrap()).collect();
        assert_eq!(chaves, vec!["recente", "nova"]);
        assert_eq!(v["enviados"][1]["em"], "2026-11-19T08:00:00-03:00");
    }

    #[test]
    fn registrar_cria_lista_vazia() {
        let mut v = Value::Null;
        registrar_chaves(&mut v, &[], "t", d("2026-11-19"));
        assert_eq!(v["enviados"], json!([]));
    }

    #[test]
    fn id_do_aparelho_estavel() {
        let a = id_do_aparelho("https://fcm.googleapis.com/fcm/send/abc");
        assert_eq!(a, id_do_aparelho("https://fcm.googleapis.com/fcm/send/abc"));
        assert_ne!(a, id_do_aparelho("https://fcm.googleapis.com/fcm/send/abd"));
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn formato_gera_chaves_uma_vez() {
        let mut v = Value::Null;
        assert!(garantir_formato(&mut v));
        let publica = v["chaves"]["publica"].clone();
        assert_eq!(v["tipos"]["fatura"], true);
        assert!(!garantir_formato(&mut v));
        assert_eq!(v["chaves"]["publica"], publica);
    }

    #[test]
    fn varias_falhas_na_rodada_contam_uma() {
        use crate::push::Entrega::Falhou;
        let mut v = json!({ "aparelhos": [ap("a", 0)] });
        let r: Vec<_> = (0..4).map(|_| ("a".to_string(), Falhou("status 503".into()))).collect();
        aplicar_entregas(&mut v, &r, "t");
        assert_eq!(v["aparelhos"][0]["falhas"], 1);
    }

    #[test]
    fn entregue_e_falhou_na_mesma_rodada_zera() {
        use crate::push::Entrega::{Entregue, Falhou};
        let mut v = json!({ "aparelhos": [ap("a", 3)] });
        aplicar_entregas(&mut v, &[("a".into(), Falhou("x".into())), ("a".into(), Entregue)], "t");
        assert_eq!(v["aparelhos"][0]["falhas"], 0);
    }

    #[test]
    fn mensagem_leva_tipo() {
        let a = Aviso { chaves: vec![], tipo: "fatura", titulo: "T".into(), texto: "X".into(), link: "#dividas".into() };
        assert_eq!(mensagem(&a), json!({ "tipo": "fatura", "titulo": "T", "texto": "X", "link": "#dividas" }));
        assert_eq!(mensagem_de_teste()["tipo"], "teste");
    }

    #[test]
    fn valida_assinatura() {
        let p = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
        assert!(validar_assinatura(p, "BTBZMqHH6r4Tts7J_aSIgg").is_ok());
        assert!(validar_assinatura("abc", "BTBZMqHH6r4Tts7J_aSIgg").is_err());
        assert!(validar_assinatura(p, "curto").is_err());
        assert!(validar_assinatura("@@@", "@@@").is_err());
    }

    #[test]
    fn limite_de_gasto_avisa_aos_80_e_ao_passar() {
        let mut c = cen();
        c.orcamentos = json!({ "limites": [{ "categoria": "mercado", "limite": 500.0 }, { "categoria": "lazer", "limite": 100.0 }] });
        c.movs = json!({ "movimentacoes": [
            { "id": "a", "data": "2026-11-02", "valor": -410.0, "natureza": "despesa", "categoria": "mercado" },
            { "id": "b", "data": "2026-11-03", "valor": -50.0, "natureza": "despesa", "categoria": "lazer" }
        ] });
        let r = rodar(&c, "2026-11-23");
        assert_eq!(so(&r, "orcamento"), vec![("orcamento:mercado:2026-11:80".to_string(), "Limite de gasto".to_string(), "Mercado já usou 82% do limite: R$ 410,00 de R$ 500,00".to_string())]);
        // Já avisado aos 80%: passa do limite e avisa de novo, uma vez.
        c.avisos = json!({ "enviados": [env("orcamento:mercado:2026-11:80")] });
        c.movs["movimentacoes"].as_array_mut().unwrap().push(json!({ "id": "c", "data": "2026-11-20", "valor": -100.0, "natureza": "despesa", "categoria": "mercado" }));
        let r = rodar(&c, "2026-11-23");
        assert_eq!(so(&r, "orcamento")[0].0, "orcamento:mercado:2026-11:80|orcamento:mercado:2026-11:100");
        assert_eq!(so(&r, "orcamento")[0].2, "Mercado passou do limite: R$ 510,00 de R$ 500,00");
        c.avisos = json!({ "enviados": [env("orcamento:mercado:2026-11:80"), env("orcamento:mercado:2026-11:100")] });
        assert!(so(&rodar(&c, "2026-11-24"), "orcamento").is_empty());
    }
}
