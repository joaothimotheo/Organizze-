//! Classificação automática de lançamentos por descrição.
//!
//! Ordem: 1) a categoria que você já deu para a mesma descrição antes;
//! 2) regras por palavra-chave; 3) "a classificar".

use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub const CATEGORIAS: [(&str, &str); 24] = [
    ("alimentacao", "Alimentação"),
    ("mercado", "Mercado"),
    ("transporte", "Transporte"),
    ("moradia", "Moradia"),
    ("contas_casa", "Contas da casa"),
    ("lazer", "Lazer"),
    ("maquinas_ursinho", "Máquinas de ursinho"),
    ("saude", "Saúde"),
    ("educacao", "Educação"),
    ("assinaturas", "Assinaturas"),
    ("compras", "Compras"),
    ("servicos", "Serviços"),
    ("impostos", "Impostos e taxas"),
    ("cuidados_pessoais", "Cuidados pessoais"),
    ("tarifas_bancarias", "Tarifas bancárias"),
    ("encargos_financeiros", "Juros e IOF"),
    ("transferencias_pix", "Pix no cartão"),
    ("transferencias", "Transferências"),
    ("investimentos", "Investimentos"),
    ("emprestimos", "Empréstimos"),
    ("salario", "Salário"),
    ("outras_receitas", "Outras receitas"),
    ("outros", "Outros"),
    ("a_classificar", "A classificar"),
];

pub fn categoria_valida(c: &str) -> bool {
    CATEGORIAS.iter().any(|(k, _)| *k == c) || c == "pagamento_fatura_cartao"
}

pub struct Regra {
    rx: Regex,
    pub categoria: &'static str,
    pub subcategoria: Option<&'static str>,
    pub confianca: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Classe {
    pub categoria: String,
    pub subcategoria: Option<String>,
    pub classificacao: String,
}

pub struct Classificador {
    regras: Vec<Regra>,
    aprendido: HashMap<String, (String, Option<String>)>,
    /// Categorias fixas que você excluiu: nunca são escolhidas automaticamente.
    ocultas: HashSet<String>,
    /// Depois de migrar para grupos: chave antiga das regras → grupo (`categorias::mapa`).
    /// Vazio = sem migrar, as regras devolvem as chaves antigas como sempre.
    mapa: HashMap<String, String>,
    /// Grupo → tipo ("gasto" ou "entrada"), depois de migrar.
    tipos: HashMap<String, String>,
}

/// Remove números de parcela, datas e espaços repetidos para comparar descrições.
pub fn normalizar(desc: &str) -> String {
    let d = desc.to_uppercase();
    let d = d.trim_start_matches("JUROS/IOF · ");
    d.split_whitespace().filter(|p| !p.chars().all(|c| c.is_ascii_digit() || c == '/')).collect::<Vec<_>>().join(" ")
}

impl Classificador {
    /// Aprende com as movimentações já gravadas (as que você classificou e as automáticas de confiança média ou alta).
    pub fn novo(movimentacoes: &Value) -> Self {
        let mut aprendido = HashMap::new();
        if let Some(l) = movimentacoes.get("movimentacoes").and_then(Value::as_array) {
            for m in l {
                let conf = m.get("classificacao").and_then(Value::as_str).unwrap_or("");
                let cat = m.get("categoria").and_then(Value::as_str).unwrap_or("");
                if cat.is_empty() || cat == "a_classificar" || !matches!(conf, "manual" | "alta" | "media") {
                    continue;
                }
                let desc = m.get("descricao").and_then(Value::as_str).unwrap_or("");
                let sub = m.get("subcategoria").and_then(Value::as_str).map(String::from);
                // Uma escolha manual sempre vence uma automática.
                let chave = normalizar(desc);
                if conf == "manual" || !aprendido.contains_key(&chave) {
                    aprendido.insert(chave, (cat.to_string(), sub));
                }
            }
        }
        Self { regras: regras_padrao(), aprendido, ocultas: HashSet::new(), mapa: HashMap::new(), tipos: HashMap::new() }
    }

    /// Não escolhe automaticamente as categorias que você excluiu.
    pub fn sem(mut self, ocultas: impl IntoIterator<Item = String>) -> Self {
        self.ocultas.extend(ocultas);
        self
    }

    /// Traduz o resultado das regras para os grupos (depois de migrar). O que foi aprendido
    /// dos lançamentos já está em ids de grupo e não passa pelo mapa.
    pub fn com_mapa(mut self, mapa: HashMap<String, String>) -> Self {
        self.mapa = mapa;
        self
    }

    /// `com_mapa(categorias::mapa(cats))` e os tipos dos grupos, para `finalizar` não pôr um
    /// lançamento num grupo do tipo errado. Sem migrar, os dois ficam vazios.
    pub fn com_grupos(mut self, cats: &Value) -> Self {
        self.tipos = crate::categorias::tipos(cats);
        self.com_mapa(crate::categorias::mapa(cats))
    }

    /// Categoria a gravar num lançamento desta natureza (`categorias::categoria_final`); sem
    /// mapa, devolve a mesma categoria.
    pub fn categoria_final(&self, natureza: &str, categoria: &str) -> String {
        crate::categorias::categoria_final(&self.mapa, natureza, categoria)
    }

    /// Põe um lançamento pronto (com `natureza` e `categoria`) no grupo final, depois de migrar.
    /// - sem grupo, ou num grupo do tipo errado para a natureza: "a classificar", sem detalhe;
    /// - chave antiga que vai para um grupo padrão diferente (Pix no cartão, Transferências,
    ///   Rendimentos, Estorno): esse nome vira o detalhe, no lugar do detalhe automático da regra.
    ///
    /// Sem mapa (não migrado), não mexe em nada. Rodar duas vezes dá o mesmo resultado.
    pub fn finalizar(&self, m: &mut Value) {
        if self.mapa.is_empty() {
            return;
        }
        let natureza = m["natureza"].as_str().unwrap_or("").to_string();
        let antes = m["categoria"].as_str().unwrap_or("").to_string();
        let (mut fim, detalhe) = crate::categorias::traducao(&self.mapa, &natureza, &antes);
        let conta = matches!(natureza.as_str(), "despesa" | "receita" | "estorno");
        if conta && self.tipos.get(&fim).is_some_and(|t| !crate::categorias::tipo_combina(t, &natureza)) {
            fim = "a_classificar".into();
        }
        if fim == "a_classificar" {
            if antes != fim {
                m["subcategoria"] = Value::Null;
                m["classificacao"] = json!("baixa");
            }
        } else if let Some(d) = detalhe {
            m["subcategoria"] = json!(d);
        }
        m["categoria"] = json!(fim);
    }

    pub fn oculta(&self, categoria: &str) -> bool {
        self.ocultas.contains(categoria)
    }

    /// Com mapa, a primeira regra que bate decide: vira o grupo dela (sem grupo, "a classificar").
    /// Uma chave que vai para um grupo padrão diferente leva o nome antigo como detalhe.
    pub fn classificar(&self, desc: &str) -> Classe {
        let (c, aprendido) = self.bruto(desc);
        if self.mapa.is_empty() || aprendido {
            return c;
        }
        let (fim, detalhe) = crate::categorias::traducao(&self.mapa, "despesa", &c.categoria);
        if fim == "a_classificar" {
            return Classe { categoria: fim, subcategoria: None, classificacao: "baixa".into() };
        }
        Classe { categoria: fim, subcategoria: detalhe.or(c.subcategoria), classificacao: c.classificacao }
    }

    /// Como `classificar`, mas devolve a chave antiga das regras sem passar pelo mapa (para quem
    /// ainda ajusta a chave e depois chama `finalizar`).
    pub fn classificar_chave(&self, desc: &str) -> Classe {
        self.bruto(desc).0
    }

    /// Resultado sem o mapa e se ele veio do que foi aprendido (já em ids de grupo).
    fn bruto(&self, desc: &str) -> (Classe, bool) {
        if let Some((c, s)) = self.aprendido.get(&normalizar(desc)).filter(|(c, _)| !self.oculta(c)) {
            return (Classe { categoria: c.clone(), subcategoria: s.clone(), classificacao: "alta".into() }, true);
        }
        let up = desc.to_uppercase();
        for r in &self.regras {
            if !self.oculta(r.categoria) && r.rx.is_match(&up) {
                let c = Classe { categoria: r.categoria.into(), subcategoria: r.subcategoria.map(String::from), classificacao: r.confianca.into() };
                return (c, false);
            }
        }
        (Classe { categoria: "a_classificar".into(), subcategoria: None, classificacao: "baixa".into() }, false)
    }
}

/// Categorias de regras criadas depois que já havia lançamentos gravados. Na partida do
/// servidor, os lançamentos que batem com essas regras e que você não classificou à mão são
/// corrigidos (a sincronização não muda a categoria de um lançamento que já existe).
const REGRAS_QUE_CORRIGEM: [&str; 1] = ["maquinas_ursinho"];

/// Aplica as regras novas aos lançamentos já gravados. Devolve quantos mudaram.
pub fn corrigir_com_regras_novas(movs: &mut Value, ocultas: &[String]) -> usize {
    let regras: Vec<Regra> =
        regras_padrao().into_iter().filter(|r| REGRAS_QUE_CORRIGEM.contains(&r.categoria) && !ocultas.iter().any(|o| o == r.categoria)).collect();
    let Some(l) = movs.get_mut("movimentacoes").and_then(Value::as_array_mut) else { return 0 };
    let mut n = 0;
    for m in l.iter_mut() {
        if m["classificacao"] == "manual" || m["natureza"].as_str().is_some_and(|x| x != "despesa") {
            continue;
        }
        let up = m["descricao"].as_str().unwrap_or("").to_uppercase();
        if let Some(r) = regras.iter().find(|r| r.rx.is_match(&up)) {
            if m["categoria"].as_str() != Some(r.categoria) {
                m["categoria"] = json!(r.categoria);
                m["subcategoria"] = Value::Null;
                m["classificacao"] = json!(r.confianca);
                n += 1;
            }
        }
    }
    n
}

fn regras_padrao() -> Vec<Regra> {
    let r = |p: &str, c: &'static str, s: Option<&'static str>, conf: &'static str| Regra { rx: Regex::new(p).unwrap(), categoria: c, subcategoria: s, confianca: conf };
    vec![
        r(r"^PIX ", "transferencias_pix", Some("pix no cartão"), "alta"),
        // Máquinas de pegar ursinho (VMT): "VMT*LOJA", "VMT.LOJA", "LOJA.VMT.X".
        r(r"(?:^|[.*])VMT[.*]", "maquinas_ursinho", None, "alta"),
        r(r"ANUIDADE", "tarifas_bancarias", Some("anuidade do cartão"), "alta"),
        r(r"SPOTIFY|NETFLIX|YOUTUB|DISNEY|PRIME VIDEO|HBO|MAX\.COM|DEEZER|GOOGLE GOOGLE|GOOGLE TINDER|APPLE\.COM|ICLOUD", "assinaturas", None, "alta"),
        r(r"AUTO ?CENTER|CENTRO AUTOM|MECANICA|PNEU", "transporte", Some("manutenção do veículo"), "media"),
        r(r"POSTO|^SIM |COMBUSTIVE|IPIRANGA|SHELL|PETROBRAS", "transporte", Some("combustível"), "alta"),
        r(r"UBER|99 ?APP|99TAXI|ESTACIONA|PEDAGIO|SEM PARAR|CONECTCAR", "transporte", None, "media"),
        r(r"IFOOD|99FOOD|BURGER KING|MC ?DONALD|SUBWAY|^SUB |CHURRASCA|LANCHONETE|LANCHES|RESTAURANTE|CHURROS|SORVETERIA|^KFC|MERENDA|PANIFICADORA|PADARIA|COMESTIVEIS|CONVENIENCIA|PIZZA|CAFE|SNACK", "alimentacao", Some("fora de casa"), "alta"),
        r(r"SUPERMERC|MERCADO (?:DO|DA)|ATACAD|ASSAI|CONDOR|MUFFATO|CARREFOUR|ANGELONI|HORTIFRUTI", "mercado", None, "media"),
        r(r"PUB|CHOPP|CINE|EVENTO|SOCCER|STEAM|PLAYSTATION|XBOX|BEBIDA|INGRESSO", "lazer", None, "media"),
        r(r"BARBER|COSMETICOS|SALAO|PERFUM", "cuidados_pessoais", None, "alta"),
        r(r"FARMACIA|DROGARIA|DROGA |RAIA|PANVEL|NISSEI|CLINICA|LABORATORIO|HOSPITAL", "saude", None, "alta"),
        r(r"MERCADOLIVRE|AMAZON|AMERICANAS|HAVAN|SHOPPING|SHOPEE|SHEIN|MAGALU|MAGAZINE|MULTIMARCAS", "compras", None, "media"),
        r(r"IOF|JUROS|ENCARGO|MULTA", "encargos_financeiros", None, "media"),
        r(r"TARIFA|CESTA|PACOTE DE SERV", "tarifas_bancarias", None, "alta"),
        r(r"IPVA|DETRAN|LICENCIAMENTO|IPTU|DARF|GPS ", "impostos", None, "alta"),
        r(r"COPEL|SANEPAR|ENERGIA ELETR|VIVO|CLARO S|CONDOMINIO|ALUGUEL", "contas_casa", None, "media"),
    ]
}

#[cfg(test)]
mod testes {
    use super::*;
    use serde_json::json;

    #[test]
    fn escolha_manual_vence_regra() {
        let movs = json!({ "movimentacoes": [
            { "descricao": "LOJA DO BAIRRO", "categoria": "mercado", "classificacao": "manual" },
            { "descricao": "STREAMING X", "categoria": "assinaturas", "classificacao": "alta" }
        ]});
        let c = Classificador::novo(&movs);
        assert_eq!(c.classificar("LOJA DO BAIRRO").categoria, "mercado");
        assert_eq!(c.classificar("AUTO POSTO EXEMPLO").categoria, "transporte");
        assert_eq!(c.classificar("LOJA DESCONHECIDA").categoria, "a_classificar");
        assert_eq!(c.classificar("PIX EMPRESA EXEMPLO").categoria, "transferencias_pix");
    }

    #[test]
    fn com_mapa_traduz_regra() {
        let mapa: HashMap<String, String> = [("assinaturas".to_string(), "p_assinaturas".to_string())].into();
        let c = Classificador::novo(&json!({})).com_mapa(mapa);
        assert_eq!(c.classificar("NETFLIX.COM").categoria, "p_assinaturas");
        let posto = c.classificar("POSTO SHELL");
        assert_eq!(posto.categoria, "a_classificar", "transporte não está no mapa");
        assert_eq!((posto.subcategoria, posto.classificacao.as_str()), (None, "baixa"));
        assert_eq!(c.categoria_final("aporte_investimento", "investimentos"), "investimentos");
        assert_eq!(c.categoria_final("estorno", "outros"), "rendimentos_estornos");
    }

    #[test]
    fn com_mapa_respeita_aprendido() {
        let movs = json!({ "movimentacoes": [{ "descricao": "IFOOD", "categoria": "p_comida", "classificacao": "manual" }] });
        let mapa: HashMap<String, String> = [("p_comida".to_string(), "p_comida".to_string())].into();
        let c = Classificador::novo(&movs).com_mapa(mapa);
        assert_eq!(c.classificar("IFOOD").categoria, "p_comida");
    }

    #[test]
    fn com_mapa_chave_de_padrao_leva_o_nome_antigo() {
        let mapa: HashMap<String, String> = [("transferencias_pix".to_string(), "outros".to_string()), ("outros".to_string(), "outros".to_string())].into();
        let c = Classificador::novo(&json!({})).com_mapa(mapa);
        let pix = c.classificar("PIX FULANO");
        assert_eq!((pix.categoria.as_str(), pix.subcategoria.as_deref()), ("outros", Some("Pix no cartão")));
        assert_eq!(c.classificar_chave("PIX FULANO").categoria, "transferencias_pix");
    }

    #[test]
    fn finalizar_recusa_grupo_de_outro_tipo() {
        let mut cats = json!({});
        crate::categorias::migrar(&mut cats, &mut json!({}), &[], "2026-11-19T10:00:00-03:00").unwrap();
        let c = Classificador::novo(&json!({})).com_grupos(&cats);
        let mut m = json!({ "natureza": "despesa", "categoria": "salario", "subcategoria": null, "classificacao": "alta" });
        c.finalizar(&mut m);
        assert_eq!((m["categoria"].as_str(), m["classificacao"].as_str()), (Some("a_classificar"), Some("baixa")));
        let mut r = json!({ "natureza": "receita", "categoria": "investimentos", "subcategoria": "algo", "classificacao": "media" });
        c.finalizar(&mut r);
        assert_eq!((r["categoria"].as_str(), r["subcategoria"].as_str()), (Some("rendimentos_estornos"), Some("Rendimentos")));
        let mut j = r.clone();
        c.finalizar(&mut j);
        assert_eq!(j, r, "rodar de novo não muda nada");
    }

    #[test]
    fn sem_mapa_nada_muda() {
        let c = Classificador::novo(&json!({})).com_mapa(HashMap::new());
        assert_eq!(c.classificar("POSTO SHELL").categoria, "transporte");
        assert_eq!(c.categoria_final("despesa", "transporte"), "transporte");
        assert_eq!(c.categoria_final("estorno", "outros"), "outros");
    }

    #[test]
    fn maquinas_de_ursinho() {
        let c = Classificador::novo(&json!({}));
        for d in ["VMT*CT LOJA", "VMT.LOJA X", "PARQUE EXEMPLO.VMT.RE"] {
            assert_eq!(c.classificar(d).categoria, "maquinas_ursinho", "{d}");
        }
        assert_eq!(c.classificar("VMTX LOJA").categoria, "a_classificar");
    }

    #[test]
    fn categoria_excluida_nao_e_escolhida() {
        let movs = json!({ "movimentacoes": [{ "descricao": "LOJA DO BAIRRO", "categoria": "lazer", "classificacao": "manual" }] });
        let c = Classificador::novo(&movs).sem(["lazer".to_string(), "transporte".to_string()]);
        assert_eq!(c.classificar("LOJA DO BAIRRO").categoria, "a_classificar");
        // A regra de combustível (transporte) é pulada; nenhuma outra pega.
        assert_eq!(c.classificar("AUTO POSTO EXEMPLO").categoria, "a_classificar");
        assert_eq!(c.classificar("VMT*LOJA").categoria, "maquinas_ursinho");
    }

    #[test]
    fn corrige_vmt_ja_gravado_sem_mexer_no_manual() {
        let mut movs = json!({ "movimentacoes": [
            { "descricao": "VMT.CT LOJA", "categoria": "compras", "classificacao": "media", "natureza": "despesa" },
            { "descricao": "VMT*CT LOJA", "categoria": "a_classificar", "classificacao": "baixa", "natureza": "despesa" },
            { "descricao": "VMT*OUTRA", "categoria": "lazer", "classificacao": "manual", "natureza": "despesa" },
            { "descricao": "VMT*ESTORNO", "categoria": "outras_receitas", "classificacao": "media", "natureza": "receita" },
            { "descricao": "MERCADO DO BAIRRO", "categoria": "mercado", "classificacao": "media", "natureza": "despesa" }
        ]});
        assert_eq!(corrigir_com_regras_novas(&mut movs.clone(), &["maquinas_ursinho".into()]), 0, "excluída: não corrige");
        assert_eq!(corrigir_com_regras_novas(&mut movs, &[]), 2);
        let cats: Vec<&str> = movs["movimentacoes"].as_array().unwrap().iter().map(|m| m["categoria"].as_str().unwrap()).collect();
        assert_eq!(cats, ["maquinas_ursinho", "maquinas_ursinho", "lazer", "outras_receitas", "mercado"]);
        assert_eq!(corrigir_com_regras_novas(&mut movs, &[]), 0, "rodar de novo não muda nada");
    }
}
