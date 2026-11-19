//! Categorias criadas por você, guardadas em `categorias.json` → `categorias[]`.
//!
//! As categorias fixas ficam em `importar::classificar::CATEGORIAS`. As suas ganham um id
//! começando com `p_` (de "própria"), para nunca colidir com uma fixa criada no futuro.
//!
//! A seção "Versão 2" (grupos e migração) fica no fim do arquivo.

use crate::emprestimos::Falha;
use crate::importar::classificar::{self, CATEGORIAS};
use serde_json::{json, Value};
use std::collections::HashMap;

const TAMANHO_MAXIMO: usize = 40;

/// Categorias fixas que não podem ser excluídas: as contas do sistema dependem delas.
pub const PROTEGIDAS: [&str; 9] =
    ["a_classificar", "outros", "salario", "outras_receitas", "transferencias", "transferencias_pix", "investimentos", "emprestimos", "pagamento_fatura_cartao"];

pub fn lista(arq: &Value) -> Vec<Value> {
    arq.get("categorias").and_then(Value::as_array).cloned().unwrap_or_default()
}

/// Categorias fixas que você excluiu (`ocultas[]`).
pub fn ocultas(arq: &Value) -> Vec<String> {
    arq.get("ocultas").and_then(Value::as_array).map(|l| l.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default()
}

fn e_oculta(arq: &Value, id: &str) -> bool {
    ocultas(arq).iter().any(|o| o == id)
}

/// Fixas e suas, na ordem em que aparecem para escolher (as suas no fim, antes de "Outros").
/// As fixas excluídas vêm com `oculta: true` (o nome ainda serve para lançamentos antigos).
pub fn todas(arq: &Value) -> Vec<Value> {
    let mut l: Vec<Value> = CATEGORIAS
        .iter()
        .map(|(k, v)| json!({ "id": k, "nome": v, "propria": false, "protegida": PROTEGIDAS.contains(k), "oculta": e_oculta(arq, k) }))
        .collect();
    let mut proprias: Vec<Value> = lista(arq).into_iter().map(|c| json!({ "id": c["id"], "nome": c["nome"], "propria": true, "protegida": false, "oculta": false })).collect();
    proprias.sort_by_key(|c| c["nome"].as_str().unwrap_or("").to_lowercase());
    let pos = l.iter().position(|c| c["id"] == "outros").unwrap_or(l.len());
    l.splice(pos..pos, proprias);
    l
}

/// A categoria existe e pode ser escolhida? Sem migrar: fixa não excluída, ou sua.
/// Migrado: um grupo, ou "a_classificar".
pub fn existe(arq: &Value, id: &str) -> bool {
    if migrado(arq) {
        return id == "a_classificar" || grupos(arq).iter().any(|g| g["id"].as_str() == Some(id));
    }
    (classificar::categoria_valida(id) && !e_oculta(arq, id)) || lista(arq).iter().any(|c| c["id"].as_str() == Some(id))
}

fn chave(nome: &str) -> String {
    nome.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn sem_acento(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        c => c,
    }
}

/// "Máquinas de ursinho" → "maquinas_de_ursinho"
pub(crate) fn slug(nome: &str) -> String {
    let mut s = String::new();
    for c in nome.to_lowercase().chars().map(sem_acento) {
        if c.is_ascii_alphanumeric() {
            s.push(c);
        } else if !s.ends_with('_') {
            s.push('_');
        }
    }
    let s = s.trim_matches('_').to_string();
    if s.is_empty() { "categoria".into() } else { s }
}

fn validar_nome(arq: &Value, nome: &str, ignorar_id: Option<&str>) -> Result<String, Falha> {
    let nome = nome.split_whitespace().collect::<Vec<_>>().join(" ");
    if nome.is_empty() {
        return Err(Falha::Invalido("dê um nome para a categoria".into()));
    }
    if nome.chars().count() > TAMANHO_MAXIMO {
        return Err(Falha::Invalido(format!("o nome pode ter até {TAMANHO_MAXIMO} letras")));
    }
    let k = chave(&nome);
    let repetida = CATEGORIAS.iter().any(|(_, n)| chave(n) == k)
        || lista(arq).iter().any(|c| c["id"].as_str() != ignorar_id && chave(c["nome"].as_str().unwrap_or("")) == k);
    if repetida {
        return Err(Falha::Invalido(format!("já existe a categoria \"{nome}\"")));
    }
    Ok(nome)
}

fn garantir(arq: &mut Value) -> &mut Vec<Value> {
    if !arq.is_object() {
        *arq = json!({});
    }
    if !arq["categorias"].is_array() {
        arq["categorias"] = json!([]);
    }
    arq["categorias"].as_array_mut().unwrap()
}

pub fn criar(arq: &mut Value, nome: &str, agora: &str) -> Result<Value, Falha> {
    let nome = validar_nome(arq, nome, None)?;
    let base = format!("p_{}", slug(&nome));
    let mut id = base.clone();
    let mut n = 2;
    while existe(arq, &id) || classificar::categoria_valida(&id) {
        id = format!("{base}_{n}");
        n += 1;
    }
    let c = json!({ "id": id, "nome": nome, "criada_em": agora });
    garantir(arq).push(c.clone());
    arq["atualizado_em"] = json!(agora);
    Ok(c)
}

pub fn renomear(arq: &mut Value, id: &str, nome: &str, agora: &str) -> Result<Value, Falha> {
    let nome = validar_nome(arq, nome, Some(id))?;
    let c = garantir(arq).iter_mut().find(|c| c["id"].as_str() == Some(id)).ok_or(Falha::NaoEncontrado("categoria não encontrada"))?;
    c["nome"] = json!(nome);
    let c = c.clone();
    arq["atualizado_em"] = json!(agora);
    Ok(c)
}

/// Exclui uma categoria sua (apaga) ou fixa (fica em `ocultas[]`, pode ser restaurada).
/// `para` é para onde vão os lançamentos dela; não pode ser a própria categoria.
pub fn excluir(arq: &mut Value, id: &str, para: &str, agora: &str) -> Result<(), Falha> {
    if para == id || !existe(arq, para) {
        return Err(Falha::Invalido("escolha outra categoria para os lançamentos".into()));
    }
    if classificar::categoria_valida(id) {
        if PROTEGIDAS.contains(&id) {
            return Err(Falha::Invalido("essa categoria é usada nas contas do sistema e não pode ser excluída".into()));
        }
        if e_oculta(arq, id) {
            return Err(Falha::NaoEncontrado("categoria não encontrada"));
        }
        garantir(arq);
        if !arq["ocultas"].is_array() {
            arq["ocultas"] = json!([]);
        }
        arq["ocultas"].as_array_mut().unwrap().push(json!(id));
    } else {
        let l = garantir(arq);
        let antes = l.len();
        l.retain(|c| c["id"].as_str() != Some(id));
        if l.len() == antes {
            return Err(Falha::NaoEncontrado("categoria não encontrada"));
        }
    }
    arq["atualizado_em"] = json!(agora);
    Ok(())
}

/// Traz de volta uma categoria fixa excluída.
pub fn restaurar(arq: &mut Value, id: &str, agora: &str) -> Result<(), Falha> {
    if !e_oculta(arq, id) {
        return Err(Falha::NaoEncontrado("categoria não encontrada entre as excluídas"));
    }
    arq["ocultas"].as_array_mut().unwrap().retain(|v| v.as_str() != Some(id));
    arq["atualizado_em"] = json!(agora);
    Ok(())
}

/// Leva os lançamentos de uma categoria para outra. Devolve quantos mudaram.
pub fn mover_lancamentos(movs: &mut Value, de: &str, para: &str) -> usize {
    let Some(l) = movs.get_mut("movimentacoes").and_then(Value::as_array_mut) else { return 0 };
    let mut n = 0;
    for m in l.iter_mut().filter(|m| m["categoria"].as_str() == Some(de)) {
        m["categoria"] = json!(para);
        m["subcategoria"] = Value::Null;
        m["classificacao"] = json!(if para == "a_classificar" { "baixa" } else { "manual" });
        n += 1;
    }
    n
}

// =====================================================================
// Versão 2: grupos (gastos) e origens (entradas)
// =====================================================================
//
// `categorias.json` migrado tem `versao: 2`, `grupos[]` (padrões e seus), `mapa{}`
// (chave antiga do classificador → id do grupo) e `migrado_em`. Os campos da versão 1
// (`categorias[]`, `ocultas[]`) ficam no arquivo como estavam.

/// Grupos padrão: não apagam e não mudam de nome. (id, nome, tipo)
pub const PADRAO: [(&str, &str, &str); 6] = [
    ("outros", "Outros gastos", "gasto"),
    ("salario", "Salário", "entrada"),
    ("renda_extra", "Renda extra", "entrada"),
    ("pix_pessoas", "Pix de pessoas", "entrada"),
    ("rendimentos_estornos", "Rendimentos e estornos", "entrada"),
    ("outras_entradas", "Outras entradas", "entrada"),
];

/// Cor inicial de cada padrão, na mesma ordem de `PADRAO`.
const COR_PADRAO: [&str; 6] = ["g8", "g1", "g2", "g3", "g4", "g8"];
const CORES: [&str; 8] = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8"];
const MAX_DETALHES: usize = 20;
/// Usos em 12 meses a partir dos quais a categoria já vem marcada na migração.
const USOS_PARA_MARCAR: u32 = 15;

/// Categorias fixas antigas que não são de gasto escolhido pelo usuário: nunca viram grupo.
const NAO_SAO_GASTO: [&str; 8] =
    ["transferencias_pix", "transferencias", "investimentos", "emprestimos", "salario", "outras_receitas", "outros", "a_classificar"];

fn detalhes_padrao(id: &str) -> Vec<&'static str> {
    if id == "rendimentos_estornos" { vec!["Rendimentos", "Estorno", "Venda"] } else { vec![] }
}

/// Para comparar nomes de grupo: sem diferenciar maiúscula, acento e espaços repetidos.
pub(crate) fn chave_grupo(nome: &str) -> String {
    nome.to_lowercase().chars().map(sem_acento).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn migrado(cats: &Value) -> bool {
    cats.get("versao").and_then(Value::as_u64) == Some(2)
}

fn padrao_json(i: usize, guardado: Option<&Value>) -> Value {
    let (id, nome, tipo) = PADRAO[i];
    let cor = guardado.and_then(|g| g["cor"].as_str()).unwrap_or(COR_PADRAO[i]);
    let detalhes = guardado.and_then(|g| g.get("detalhes")).filter(|d| d.is_array()).cloned().unwrap_or_else(|| json!(detalhes_padrao(id)));
    let pede_pessoa = guardado.and_then(|g| g["pede_pessoa"].as_bool()).unwrap_or(false);
    json!({ "id": id, "nome": nome, "tipo": tipo, "cor": cor, "detalhes": detalhes, "pede_pessoa": pede_pessoa, "padrao": true })
}

/// Todos os grupos: por tipo (gasto, depois entrada), padrões primeiro, depois os seus em ordem
/// alfabética, e `outros` / `outras_entradas` por último no seu tipo. Dos padrões guardados só
/// valem cor, detalhes e pede_pessoa; id, nome e tipo vêm sempre de `PADRAO`.
pub fn grupos(cats: &Value) -> Vec<Value> {
    let guardados: Vec<Value> = cats.get("grupos").and_then(Value::as_array).cloned().unwrap_or_default();
    let e_padrao = |id: &str| PADRAO.iter().any(|(p, _, _)| *p == id);
    let mut l = vec![];
    for tipo in ["gasto", "entrada"] {
        let mut fim = vec![];
        for (i, (id, _, t)) in PADRAO.iter().enumerate() {
            if *t != tipo {
                continue;
            }
            let g = padrao_json(i, guardados.iter().find(|g| g["id"].as_str() == Some(id)));
            if *id == "outros" || *id == "outras_entradas" { fim.push(g) } else { l.push(g) }
        }
        let mut seus: Vec<Value> = guardados
            .iter()
            .filter(|g| g["tipo"].as_str() == Some(tipo) && !g["id"].as_str().map(e_padrao).unwrap_or(true))
            .map(|g| {
                json!({
                    "id": g["id"], "nome": g["nome"], "tipo": tipo,
                    "cor": g["cor"].as_str().unwrap_or("g1"),
                    "detalhes": g.get("detalhes").filter(|d| d.is_array()).cloned().unwrap_or_else(|| json!([])),
                    "pede_pessoa": g["pede_pessoa"].as_bool().unwrap_or(false),
                    "padrao": false
                })
            })
            .collect();
        seus.sort_by_key(|g| chave_grupo(g["nome"].as_str().unwrap_or("")));
        l.extend(seus);
        l.extend(fim);
    }
    l
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct UsoAntigo {
    pub id: String,
    pub nome: String,
    pub usos: u32,
    pub marcada: bool,
}

/// Data AAAA-MM-DD de 12 meses antes (comparação por texto; 29/02 vira 29/02 do ano anterior,
/// o que não atrapalha a comparação).
fn doze_meses_antes(hoje: &str) -> String {
    match hoje.get(0..4).and_then(|a| a.parse::<i32>().ok()) {
        Some(ano) => format!("{:04}{}", ano - 1, &hoje[4..]),
        None => String::new(),
    }
}

fn lancamentos(movs: &Value) -> &[Value] {
    movs.get("movimentacoes").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

/// Nome antigo de uma chave: fixa pelo `CATEGORIAS`, sua pelo `categorias[]`.
fn nome_antigo(cats: &Value, id: &str) -> Option<String> {
    CATEGORIAS
        .iter()
        .find(|(k, _)| *k == id)
        .map(|(_, n)| n.to_string())
        .or_else(|| lista(cats).iter().find(|c| c["id"].as_str() == Some(id)).and_then(|c| c["nome"].as_str().map(String::from)))
}

/// Chave antiga de gasto (fixa de gasto, oculta ou não, ou sua `p_…`): sem grupo, vai para `outros`.
fn e_gasto_antigo(id: &str) -> bool {
    id.starts_with("p_") || (CATEGORIAS.iter().any(|(k, _)| *k == id) && !NAO_SAO_GASTO.contains(&id))
}

/// Categorias de gasto de hoje com o uso (lançamentos `despesa`) nos últimos 12 meses,
/// maior uso primeiro. As fixas que você excluiu não aparecem.
pub fn uso_antigo(cats: &Value, movs: &Value, hoje: &str) -> Vec<UsoAntigo> {
    let desde = doze_meses_antes(hoje);
    let mut l: Vec<UsoAntigo> = CATEGORIAS
        .iter()
        .filter(|(k, _)| !NAO_SAO_GASTO.contains(k) && !e_oculta(cats, k))
        .map(|(k, n)| (k.to_string(), n.to_string()))
        .chain(lista(cats).iter().filter_map(|c| Some((c["id"].as_str()?.to_string(), c["nome"].as_str().unwrap_or("").to_string()))))
        .map(|(id, nome)| UsoAntigo { id, nome, usos: 0, marcada: false })
        .collect();
    for m in lancamentos(movs) {
        if m["natureza"].as_str() != Some("despesa") {
            continue;
        }
        let data = m["data"].as_str().unwrap_or("");
        let data = data.get(0..10).unwrap_or(data);
        if data <= desde.as_str() || data > hoje {
            continue;
        }
        if let Some(u) = l.iter_mut().find(|u| m["categoria"].as_str() == Some(u.id.as_str())) {
            u.usos += 1;
        }
    }
    for u in l.iter_mut() {
        u.marcada = u.usos >= USOS_PARA_MARCAR;
    }
    // estável: no empate, fica a ordem de CATEGORIAS e depois a das suas
    l.sort_by(|a, b| b.usos.cmp(&a.usos));
    l
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ResumoMigracao {
    /// Grupos seus criados (as categorias mantidas).
    pub grupos: usize,
    /// Lançamentos que mudaram de categoria ou de detalhe.
    pub movidos: usize,
}

/// Nome que ainda não existe entre `usados` (chaves de `chave_grupo`): "Saúde", "Saúde 2", …
fn nome_livre(usados: &[String], nome: &str) -> String {
    let nome = nome.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut n = 2;
    let mut tentativa = nome.clone();
    while usados.contains(&chave_grupo(&tentativa)) {
        tentativa = format!("{nome} {n}");
        n += 1;
    }
    tentativa
}

/// Detalhes de um grupo novo: subcategorias dos lançamentos dele, sem repetir, mais usadas primeiro.
fn detalhes_vistos(movs: &Value, id: &str) -> Vec<String> {
    let mut contagem: Vec<(String, usize)> = vec![];
    for m in lancamentos(movs).iter().filter(|m| m["categoria"].as_str() == Some(id)) {
        let Some(sub) = m["subcategoria"].as_str().map(str::trim).filter(|s| !s.is_empty() && s.chars().count() <= TAMANHO_MAXIMO) else { continue };
        match contagem.iter_mut().find(|(d, _)| chave_grupo(d) == chave_grupo(sub)) {
            Some((_, n)) => *n += 1,
            None => contagem.push((sub.to_string(), 1)),
        }
    }
    contagem.sort_by(|a, b| b.1.cmp(&a.1));
    contagem.into_iter().take(MAX_DETALHES).map(|(d, _)| d).collect()
}

/// Põe o lançamento no grupo com `detalhe` como subcategoria (sempre). A subcategoria de antes,
/// se havia e é outra (comparando por `chave_grupo`), vai para `detalhe_antigo`, mas só se ele
/// ainda estiver vazio: um detalhe antigo já guardado não é sobrescrito.
fn mover_com_detalhe(m: &mut Value, grupo: &str, detalhe: &str) {
    m["categoria"] = json!(grupo);
    guardar_detalhe_antigo(m, detalhe);
    m["subcategoria"] = json!(detalhe);
}

/// Guarda a subcategoria atual em `detalhe_antigo` antes de trocá-la por `novo` (veja `mover_com_detalhe`).
fn guardar_detalhe_antigo(m: &mut Value, novo: &str) {
    let antiga = m["subcategoria"].as_str().map(str::trim).filter(|s| !s.is_empty() && chave_grupo(s) != chave_grupo(novo)).map(String::from);
    let vazio = m.get("detalhe_antigo").and_then(Value::as_str).map(str::trim).unwrap_or("").is_empty();
    if let (Some(a), true) = (antiga, vazio) {
        m["detalhe_antigo"] = json!(a);
    }
}

/// Migração de uma vez da versão 1 para a 2. `manter` são as categorias de `uso_antigo` que
/// viram grupo (com o mesmo id); as outras de gasto vão para `outros` com o nome antigo como
/// detalhe (a subcategoria de antes vai para `detalhe_antigo`, veja `mover_com_detalhe`). Ids fora de `uso_antigo` (como `transferencias_pix`) são ignorados.
/// `classificacao` e `nome` dos lançamentos não mudam.
pub fn migrar(cats: &mut Value, movs: &mut Value, manter: &[String], agora: &str) -> Result<ResumoMigracao, Falha> {
    if migrado(cats) {
        return Err(Falha::Conflito("as categorias já foram migradas".into()));
    }
    if !cats.is_object() {
        *cats = json!({});
    }
    let hoje = agora.get(0..10).unwrap_or(agora);
    let mantidas: Vec<UsoAntigo> = uso_antigo(cats, movs, hoje).into_iter().filter(|u| manter.contains(&u.id)).collect();

    let mut lista_grupos: Vec<Value> = (0..PADRAO.len()).map(|i| padrao_json(i, None)).collect();
    let mut usados: Vec<String> = PADRAO.iter().map(|(_, n, _)| chave_grupo(n)).collect();
    let mut mapa = serde_json::Map::new();
    for (i, u) in mantidas.iter().enumerate() {
        let nome = nome_livre(&usados, &u.nome);
        usados.push(chave_grupo(&nome));
        lista_grupos.push(json!({
            "id": u.id, "nome": nome, "tipo": "gasto", "cor": CORES[i % CORES.len()],
            "detalhes": detalhes_vistos(movs, &u.id), "pede_pessoa": false, "padrao": false
        }));
        mapa.insert(u.id.clone(), json!(u.id));
    }
    mapa.insert("salario".into(), json!("salario"));
    mapa.insert("outras_receitas".into(), json!("outras_entradas"));
    mapa.insert("investimentos".into(), json!("rendimentos_estornos"));
    // Só valem para despesa (o guarda de natureza de `categoria_final`).
    for k in ["transferencias", "transferencias_pix", "emprestimos"] {
        mapa.insert(k.into(), json!("outros"));
    }
    let tipo_de = |id: &str| lista_grupos.iter().find(|g| g["id"].as_str() == Some(id)).and_then(|g| g["tipo"].as_str()).map(String::from);

    let mut movidos = 0;
    if let Some(l) = movs.get_mut("movimentacoes").and_then(Value::as_array_mut) {
        for m in l.iter_mut() {
            let antes = (m["categoria"].clone(), m["subcategoria"].clone());
            let cat = m["categoria"].as_str().unwrap_or("").to_string();
            let natureza = m["natureza"].as_str().unwrap_or("").to_string();
            if natureza == "estorno" {
                mover_com_detalhe(m, "rendimentos_estornos", "Estorno");
            } else if cat == "transferencias_pix" {
                mover_com_detalhe(m, "outros", "Pix no cartão");
            } else if cat == "outras_receitas" {
                m["categoria"] = json!("outras_entradas");
            } else if cat == "investimentos" && natureza == "receita" {
                mover_com_detalhe(m, "rendimentos_estornos", "Rendimentos");
            } else if mantidas.iter().any(|u| u.id == cat) {
                // continua no grupo de mesmo id
            } else if e_gasto_antigo(&cat) {
                let nome = nome_antigo(cats, &cat).unwrap_or_else(|| cat.clone());
                mover_com_detalhe(m, "outros", &nome);
            }
            // Nenhuma chave órfã: gasto termina num grupo de gasto e entrada num de entrada
            // (ou "a classificar"), com o nome antigo como detalhe.
            let agora_cat = m["categoria"].as_str().unwrap_or("").to_string();
            let destino = match natureza.as_str() {
                "despesa" => Some(("gasto", "outros")),
                "receita" => Some(("entrada", "outras_entradas")),
                _ => None,
            };
            if let Some((tipo, grupo)) = destino {
                if !agora_cat.is_empty() && agora_cat != "a_classificar" && tipo_de(&agora_cat).as_deref() != Some(tipo) {
                    let nome = nome_antigo(cats, &cat).unwrap_or_else(|| cat.clone());
                    mover_com_detalhe(m, grupo, &nome);
                }
            }
            if (m["categoria"].clone(), m["subcategoria"].clone()) != antes {
                movidos += 1;
            }
        }
    }

    cats["versao"] = json!(2);
    cats["grupos"] = Value::Array(lista_grupos);
    cats["mapa"] = Value::Object(mapa);
    cats["migrado_em"] = json!(agora);
    cats["atualizado_em"] = json!(agora);
    Ok(ResumoMigracao { grupos: mantidas.len(), movidos })
}

/// Tradução para o classificador: o `mapa` guardado (chave antiga → grupo) mais cada id de
/// grupo existente apontando para si mesmo, para que um id de grupo continue valendo.
/// Vazio enquanto não migrado (o classificador e a sincronização seguem como antes).
pub fn mapa(cats: &Value) -> HashMap<String, String> {
    if !migrado(cats) {
        return HashMap::new();
    }
    let mut m: HashMap<String, String> = cats
        .get("mapa")
        .and_then(Value::as_object)
        .map(|o| o.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect())
        .unwrap_or_default();
    for g in grupos(cats) {
        if let Some(id) = g["id"].as_str() {
            m.insert(id.to_string(), id.to_string());
        }
    }
    m
}

/// Grupo final de uma categoria vinda do classificador (chave antiga) ou já de grupo.
/// `estorno` vai sempre para `rendimentos_estornos`; sem correspondência, `a_classificar`.
/// Só traduz gastos e entradas (natureza despesa, receita ou estorno): as outras naturezas
/// (aporte, transferência, empréstimo...) ficam com a categoria que vieram. Mapa vazio (não
/// migrado): nada muda.
pub fn categoria_final(mapa: &HashMap<String, String>, natureza: &str, categoria: &str) -> String {
    if mapa.is_empty() || !matches!(natureza, "despesa" | "receita" | "estorno") {
        return categoria.into();
    }
    if natureza == "estorno" {
        return "rendimentos_estornos".into();
    }
    match mapa.get(categoria) {
        // Um grupo padrão do outro tipo (receita de `emprestimos` → Outros gastos) não serve.
        Some(g) if PADRAO.iter().any(|(id, _, tipo)| id == g && !tipo_combina(tipo, natureza)) => "a_classificar".into(),
        Some(g) => g.clone(),
        None => "a_classificar".into(),
    }
}

/// `categoria_final` mais o detalhe que a chave antiga deixa quando vai para um grupo padrão
/// diferente dela: "Pix no cartão", "Transferências", "Rendimentos", "Estorno"...
/// (`outras_receitas` → Outras entradas não precisa de detalhe.)
pub fn traducao(mapa: &HashMap<String, String>, natureza: &str, categoria: &str) -> (String, Option<String>) {
    let fim = categoria_final(mapa, natureza, categoria);
    if fim == categoria || !PADRAO.iter().any(|(id, _, _)| *id == fim) {
        return (fim, None);
    }
    let detalhe = if natureza == "estorno" {
        "Estorno".to_string()
    } else if categoria == "investimentos" {
        "Rendimentos".to_string()
    } else if categoria == "outras_receitas" {
        return (fim, None);
    } else {
        CATEGORIAS.iter().find(|(k, _)| *k == categoria).map(|(_, n)| n.to_string()).unwrap_or_else(|| categoria.to_string())
    };
    (fim, Some(detalhe))
}

/// Um grupo deste tipo serve para esta natureza? Gasto ↔ despesa; entrada ↔ receita ou estorno.
/// As outras naturezas não usam grupo.
pub fn tipo_combina(tipo: &str, natureza: &str) -> bool {
    match tipo {
        "gasto" => natureza == "despesa",
        "entrada" => matches!(natureza, "receita" | "estorno"),
        _ => true,
    }
}

/// Grupo → tipo ("gasto" ou "entrada"); vazio enquanto não migrado.
pub fn tipos(cats: &Value) -> HashMap<String, String> {
    if !migrado(cats) {
        return HashMap::new();
    }
    grupos(cats).iter().filter_map(|g| Some((g["id"].as_str()?.to_string(), g["tipo"].as_str()?.to_string()))).collect()
}

/// Depois de migrar, um grupo de gasto só serve para `despesa` e um de entrada para `receita`
/// ou `estorno`. Sem migrar, ou com uma categoria que não é grupo, não confere nada.
pub fn conferir_tipo(cats: &Value, categoria: &str, natureza: &str) -> Result<(), Falha> {
    match tipos(cats).get(categoria).map(String::as_str) {
        Some(t @ "gasto") if !tipo_combina(t, natureza) => Err(Falha::Invalido("essa categoria é de gastos".into())),
        Some(t @ "entrada") if !tipo_combina(t, natureza) => Err(Falha::Invalido("essa categoria é de entradas".into())),
        _ => Ok(()),
    }
}

/// Muda a natureza de um lançamento. Depois de migrar, se o grupo dele não serve para a natureza
/// nova, ele volta para "a classificar" (sem detalhe).
pub fn ajustar_a_natureza(cats: &Value, m: &mut Value, natureza: &str) {
    m["natureza"] = json!(natureza);
    let cat = m["categoria"].as_str().unwrap_or("").to_string();
    if conferir_tipo(cats, &cat, natureza).is_err() {
        m["categoria"] = json!("a_classificar");
        m["subcategoria"] = Value::Null;
        m["classificacao"] = json!("baixa");
    }
}

// ---------- Criar, editar e apagar grupos; sugestões ----------

#[derive(Debug, Clone, serde::Deserialize)]
pub struct NovoGrupo {
    pub nome: String,
    pub tipo: String,
    pub cor: String,
    #[serde(default)]
    pub detalhes: Vec<String>,
    #[serde(default)]
    pub pede_pessoa: bool,
    #[serde(default)]
    pub absorver_detalhe: Option<String>,
}

fn exigir_migrado(cats: &Value) -> Result<(), Falha> {
    if migrado(cats) { Ok(()) } else { Err(Falha::Invalido("as categorias ainda não foram migradas".into())) }
}

/// Nome de grupo: 1 a 40 letras, sem espaços repetidos, único entre todos os grupos
/// (sem diferenciar maiúscula, acento e espaços), ignorando o próprio grupo na edição.
fn validar_nome_grupo(cats: &Value, nome: &str, ignorar_id: Option<&str>) -> Result<String, Falha> {
    let nome = nome.split_whitespace().collect::<Vec<_>>().join(" ");
    let n = nome.chars().count();
    if n == 0 || n > TAMANHO_MAXIMO {
        return Err(Falha::Invalido(format!("o nome do grupo deve ter de 1 a {TAMANHO_MAXIMO} letras")));
    }
    let chave = chave_grupo(&nome);
    if grupos(cats).iter().any(|g| g["id"].as_str() != ignorar_id && chave_grupo(g["nome"].as_str().unwrap_or("")) == chave) {
        return Err(Falha::Invalido("já existe um grupo com esse nome".into()));
    }
    Ok(nome)
}

fn validar_cor(cor: &str) -> Result<(), Falha> {
    if CORES.contains(&cor) { Ok(()) } else { Err(Falha::Invalido("cor inválida".into())) }
}

/// Detalhes limpos: sem espaços repetidos, sem vazios, sem repetir, até 20 de até 40 letras.
fn validar_detalhes(detalhes: &[String]) -> Result<Vec<String>, Falha> {
    let mut l: Vec<String> = vec![];
    for d in detalhes {
        let d = d.split_whitespace().collect::<Vec<_>>().join(" ");
        if d.is_empty() || l.iter().any(|x| chave_grupo(x) == chave_grupo(&d)) {
            continue;
        }
        if d.chars().count() > TAMANHO_MAXIMO {
            return Err(Falha::Invalido(format!("cada detalhe deve ter até {TAMANHO_MAXIMO} letras")));
        }
        l.push(d);
    }
    if l.len() > MAX_DETALHES {
        return Err(Falha::Invalido(format!("no máximo {MAX_DETALHES} detalhes por grupo")));
    }
    Ok(l)
}

/// Guarda o grupo em `cats["grupos"]`, trocando o de mesmo id se já existir.
fn guardar_grupo(cats: &mut Value, g: &Value, agora: &str) {
    if !cats["grupos"].is_array() {
        cats["grupos"] = json!([]);
    }
    let l = cats["grupos"].as_array_mut().unwrap();
    match l.iter_mut().find(|x| x["id"] == g["id"]) {
        Some(x) => *x = g.clone(),
        None => l.push(g.clone()),
    }
    cats["atualizado_em"] = json!(agora);
}

/// Cria um grupo seu. Com `absorver_detalhe` (e tipo gasto), os lançamentos de `outros` com essa
/// subcategoria (sem diferenciar maiúscula, acento e espaços), de qualquer data, vão para o grupo
/// novo, que ganha o detalhe. Um grupo de gasto com o nome de uma categoria antiga que ainda não
/// está no `mapa` entra nele no lugar dela. Devolve o grupo e quantos lançamentos foram movidos.
pub fn criar_grupo(cats: &mut Value, movs: &mut Value, n: &NovoGrupo, agora: &str, _hoje: &str) -> Result<(Value, usize), Falha> {
    exigir_migrado(cats)?;
    let nome = validar_nome_grupo(cats, &n.nome, None)?;
    if n.tipo != "gasto" && n.tipo != "entrada" {
        return Err(Falha::Invalido("tipo inválido: use gasto ou entrada".into()));
    }
    validar_cor(&n.cor)?;
    let absorver = n.absorver_detalhe.as_deref().map(|d| d.split_whitespace().collect::<Vec<_>>().join(" ")).filter(|d| !d.is_empty() && n.tipo == "gasto");
    let mut detalhes = n.detalhes.clone();
    if let Some(d) = &absorver {
        detalhes.retain(|x| chave_grupo(x) != chave_grupo(d));
        detalhes.insert(0, d.clone());
    }
    let detalhes = validar_detalhes(&detalhes)?;

    let ocupados: Vec<String> = grupos(cats).iter().filter_map(|g| g["id"].as_str().map(String::from)).collect();
    let base = format!("p_{}", slug(&nome));
    let mut id = base.clone();
    let mut k = 2;
    while ocupados.contains(&id) {
        id = format!("{base}_{k}");
        k += 1;
    }

    let mut movidos = 0;
    if let (Some(d), Some(l)) = (&absorver, movs.get_mut("movimentacoes").and_then(Value::as_array_mut)) {
        let absorve = |x: &Value| x["categoria"].as_str() == Some("outros") && x["subcategoria"].as_str().map(chave_grupo) == Some(chave_grupo(d));
        for m in l.iter_mut() {
            if let Some(partes) = m.get_mut("partes").and_then(Value::as_array_mut).filter(|p| !p.is_empty()) {
                // Dividido: as partes com o detalhe vão para o grupo novo e a categoria do
                // lançamento é recalculada.
                let mut mudou = false;
                for p in partes.iter_mut().filter(|p| absorve(p)) {
                    p["categoria"] = json!(id);
                    p["subcategoria"] = json!(d);
                    mudou = true;
                }
                if mudou {
                    let partes = partes.clone();
                    m["categoria"] = json!(crate::lancamentos::categoria_principal(&partes));
                    m["subcategoria"] = crate::lancamentos::detalhe_principal(&partes);
                    movidos += 1;
                }
            } else if absorve(m) {
                m["categoria"] = json!(id);
                m["subcategoria"] = json!(d);
                movidos += 1;
            }
        }
    }

    // Nome igual ao de uma categoria de gasto antiga que ficou sem grupo ("Transporte"): a chave
    // dela passa a apontar para o grupo novo, e a classificação automática cai nele.
    if n.tipo == "gasto" {
        let antigas: Vec<String> = CATEGORIAS
            .iter()
            .map(|(k, _)| k.to_string())
            .chain(lista(cats).iter().filter_map(|c| c["id"].as_str().map(String::from)))
            .filter(|k| e_gasto_antigo(k) && !PROTEGIDAS.contains(&k.as_str()))
            .filter(|k| nome_antigo(cats, k).is_some_and(|a| chave_grupo(&a) == chave_grupo(&nome)))
            .collect();
        if !cats["mapa"].is_object() {
            cats["mapa"] = json!({});
        }
        let mapa = cats["mapa"].as_object_mut().unwrap();
        for k in antigas {
            mapa.entry(k).or_insert_with(|| json!(id));
        }
    }

    let g = json!({ "id": id, "nome": nome, "tipo": n.tipo, "cor": n.cor, "detalhes": detalhes, "pede_pessoa": n.pede_pessoa, "padrao": false });
    guardar_grupo(cats, &g, agora);
    Ok((g, movidos))
}

/// Edita um grupo. Grupo seu: nome, cor, detalhes e pede_pessoa. Padrão: só cor e detalhes.
pub fn editar_grupo(cats: &mut Value, id: &str, n: &NovoGrupo, agora: &str) -> Result<Value, Falha> {
    exigir_migrado(cats)?;
    let atual = grupos(cats).into_iter().find(|g| g["id"].as_str() == Some(id)).ok_or(Falha::NaoEncontrado("grupo não encontrado"))?;
    validar_cor(&n.cor)?;
    let detalhes = validar_detalhes(&n.detalhes)?;
    let mut g = atual.clone();
    g["cor"] = json!(n.cor);
    g["detalhes"] = json!(detalhes);
    if atual["padrao"] != true {
        g["nome"] = json!(validar_nome_grupo(cats, &n.nome, Some(id))?);
        g["pede_pessoa"] = json!(n.pede_pessoa);
    }
    guardar_grupo(cats, &g, agora);
    Ok(g)
}

/// Apaga um grupo seu. Os lançamentos vão para `outros` (gasto) ou `outras_entradas` (entrada),
/// com o nome do grupo como detalhe; um detalhe que já existia vai para `detalhe_antigo` (sem
/// sobrescrever um que já estava lá), como na migração. Tira do `mapa` o que apontava para ele. Devolve quantos lançamentos mudaram.
pub fn apagar_grupo(cats: &mut Value, movs: &mut Value, id: &str, agora: &str) -> Result<usize, Falha> {
    exigir_migrado(cats)?;
    let g = grupos(cats).into_iter().find(|g| g["id"].as_str() == Some(id)).ok_or(Falha::NaoEncontrado("grupo não encontrado"))?;
    if g["padrao"] == true {
        return Err(Falha::Invalido("os grupos padrão não podem ser apagados".into()));
    }
    let nome = g["nome"].as_str().unwrap_or("").to_string();
    let destino = if g["tipo"] == "entrada" { "outras_entradas" } else { "outros" };
    let mut movidos = 0;
    if let Some(l) = movs.get_mut("movimentacoes").and_then(Value::as_array_mut) {
        for m in l.iter_mut().filter(|m| m["categoria"].as_str() == Some(id) || crate::lancamentos::partes_de(m).iter().any(|(_, c)| c == id)) {
            if m["categoria"].as_str() == Some(id) {
                mover_com_detalhe(m, destino, &nome);
            }
            // Partes no grupo apagado vão para o mesmo destino, com o nome dele como detalhe.
            for p in m.get_mut("partes").and_then(Value::as_array_mut).into_iter().flatten().filter(|p| p["categoria"].as_str() == Some(id)) {
                mover_com_detalhe(p, destino, &nome);
            }
            movidos += 1;
        }
    }
    if let Some(l) = cats.get_mut("grupos").and_then(Value::as_array_mut) {
        l.retain(|x| x["id"].as_str() != Some(id));
    }
    if let Some(o) = cats.get_mut("mapa").and_then(Value::as_object_mut) {
        o.retain(|_, v| v.as_str() != Some(id));
    }
    cats["atualizado_em"] = json!(agora);
    Ok(movidos)
}

/// Detalhes de `outros` que apareceram 3 vezes ou mais nos últimos 90 dias e ainda não são nome
/// de grupo: `{ detalhe, lancamentos: [id], total }`, maior total primeiro. Detalhes iguais sem
/// diferenciar maiúscula, acento e espaços contam juntos; o rótulo mostrado é o que começa com
/// maiúscula e, entre esses, o mais usado.
pub fn sugestoes(cats: &Value, movs: &Value, hoje: &str) -> Vec<Value> {
    let Ok(hoje_d) = chrono::NaiveDate::parse_from_str(hoje.get(0..10).unwrap_or(hoje), "%Y-%m-%d") else { return vec![] };
    let desde = (hoje_d - chrono::Duration::days(90)).format("%Y-%m-%d").to_string();
    let hoje = hoje_d.format("%Y-%m-%d").to_string();
    let nomes: Vec<String> = grupos(cats).iter().map(|g| chave_grupo(g["nome"].as_str().unwrap_or(""))).collect();
    // chave do detalhe → (rótulos com quantas vezes, lançamentos com data, total)
    let mut por: Vec<(String, Vec<(String, usize)>, Vec<(String, String)>, f64)> = vec![];
    for m in lancamentos(movs).iter().filter(|m| m["categoria"].as_str() == Some("outros")) {
        let Some(d) = m["subcategoria"].as_str().map(str::trim).filter(|s| !s.is_empty()) else { continue };
        let data = m["data"].as_str().unwrap_or("");
        let data = data.get(0..10).unwrap_or(data);
        if data <= desde.as_str() || data > hoje.as_str() || nomes.contains(&chave_grupo(d)) {
            continue;
        }
        let item = (data.to_string(), m["id"].as_str().unwrap_or("").to_string());
        let valor = m["valor"].as_f64().unwrap_or(0.0).abs();
        let k = chave_grupo(d);
        let i = match por.iter().position(|(x, _, _, _)| *x == k) {
            Some(i) => i,
            None => {
                por.push((k, vec![], vec![], 0.0));
                por.len() - 1
            }
        };
        let (_, rotulos, l, t) = &mut por[i];
        match rotulos.iter_mut().find(|(r, _)| r == d) {
            Some((_, n)) => *n += 1,
            None => rotulos.push((d.to_string(), 1)),
        }
        l.push(item);
        *t += valor;
    }
    let maiuscula = |r: &str| r.chars().next().is_some_and(char::is_uppercase);
    let mut por: Vec<(String, Vec<(String, String)>, f64)> = por
        .into_iter()
        .filter(|(_, _, l, _)| l.len() >= 3)
        .map(|(_, rotulos, l, t)| {
            // estável: no empate fica o primeiro visto
            let mut melhor = &rotulos[0];
            for r in &rotulos[1..] {
                if (maiuscula(&r.0), r.1) > (maiuscula(&melhor.0), melhor.1) {
                    melhor = r;
                }
            }
            (melhor.0.clone(), l, t)
        })
        .collect();
    por.sort_by(|a, b| b.2.total_cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    por.into_iter()
        .map(|(d, mut l, t)| {
            l.sort_by(|a, b| b.0.cmp(&a.0));
            json!({ "detalhe": d, "lancamentos": l.into_iter().map(|(_, id)| id).collect::<Vec<_>>(), "total": (t * 100.0).round() / 100.0 })
        })
        .collect()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn cria_com_id_proprio_e_recusa_repetida() {
        let mut arq = json!({});
        let c = criar(&mut arq, "  Presentes  de   Natal ", "agora").unwrap();
        assert_eq!((c["id"].as_str(), c["nome"].as_str()), (Some("p_presentes_de_natal"), Some("Presentes de Natal")));
        assert!(existe(&arq, "p_presentes_de_natal"));
        assert!(criar(&mut arq, "presentes de natal", "agora").is_err());
        assert!(criar(&mut arq, "Mercado", "agora").is_err(), "não pode repetir uma fixa");
        assert!(criar(&mut arq, "", "agora").is_err());
        assert!(criar(&mut arq, &"x".repeat(41), "agora").is_err());
    }

    #[test]
    fn renomeia_exclui_e_solta_lancamentos() {
        let mut arq = json!({});
        criar(&mut arq, "Pet", "agora").unwrap();
        criar(&mut arq, "Viagem", "agora").unwrap();
        assert!(renomear(&mut arq, "p_pet", "Viagem", "agora").is_err());
        assert_eq!(renomear(&mut arq, "p_pet", "Pet e veterinário", "agora").unwrap()["nome"], "Pet e veterinário");
        let t = todas(&arq);
        let ids: Vec<&str> = t.iter().filter_map(|c| c["id"].as_str()).collect();
        let pos_pet = ids.iter().position(|i| *i == "p_pet").unwrap();
        assert_eq!(ids[pos_pet + 2], "outros", "as suas ficam antes de Outros");

        let mut movs = json!({ "movimentacoes": [
            { "id": "a", "categoria": "p_pet", "classificacao": "manual" },
            { "id": "b", "categoria": "mercado", "classificacao": "manual" }
        ]});
        assert!(excluir(&mut arq, "p_pet", "p_pet", "agora").is_err(), "não move para ela mesma");
        excluir(&mut arq, "p_pet", "a_classificar", "agora").unwrap();
        assert_eq!(mover_lancamentos(&mut movs, "p_pet", "a_classificar"), 1);
        assert_eq!(movs["movimentacoes"][0]["categoria"], "a_classificar");
        assert_eq!(movs["movimentacoes"][0]["classificacao"], "baixa");
        assert!(!existe(&arq, "p_pet"));
        assert_eq!(excluir(&mut arq, "p_pet", "a_classificar", "agora"), Err(Falha::NaoEncontrado("categoria não encontrada")));
    }

    #[test]
    fn exclui_e_restaura_categoria_fixa() {
        let mut arq = json!({});
        assert!(excluir(&mut arq, "salario", "a_classificar", "agora").is_err(), "protegida");
        excluir(&mut arq, "maquinas_ursinho", "lazer", "agora").unwrap();
        assert!(!existe(&arq, "maquinas_ursinho"));
        assert_eq!(ocultas(&arq), ["maquinas_ursinho"]);
        assert!(todas(&arq).iter().any(|c| c["id"] == "maquinas_ursinho" && c["oculta"] == true));
        assert!(excluir(&mut arq, "lazer", "maquinas_ursinho", "agora").is_err(), "destino excluído");
        let mut movs = json!({ "movimentacoes": [{ "id": "a", "categoria": "maquinas_ursinho", "classificacao": "alta" }] });
        assert_eq!(mover_lancamentos(&mut movs, "maquinas_ursinho", "lazer"), 1);
        assert_eq!((movs["movimentacoes"][0]["categoria"].as_str(), movs["movimentacoes"][0]["classificacao"].as_str()), (Some("lazer"), Some("manual")));
        restaurar(&mut arq, "maquinas_ursinho", "agora").unwrap();
        assert!(existe(&arq, "maquinas_ursinho"));
        assert!(restaurar(&mut arq, "maquinas_ursinho", "agora").is_err());
    }

    // ---------- Versão 2 ----------

    fn lanc(id: &str, data: &str, natureza: &str, categoria: &str, sub: Option<&str>) -> Value {
        json!({ "id": id, "data": data, "descricao": "X", "valor": -10.0, "natureza": natureza, "categoria": categoria, "subcategoria": sub, "classificacao": "alta" })
    }

    fn movs_de(l: Vec<Value>) -> Value {
        json!({ "movimentacoes": l })
    }

    fn achar<'a>(movs: &'a Value, id: &str) -> &'a Value {
        movs["movimentacoes"].as_array().unwrap().iter().find(|m| m["id"] == id).unwrap()
    }

    const HOJE: &str = "2026-11-19";

    #[test]
    fn uso_antigo_conta_12_meses_e_marca_15() {
        let mut l = vec![];
        for i in 0..16 {
            l.push(lanc(&format!("m{i}"), "2026-03-10", "despesa", "mercado", None));
        }
        for i in 0..20 {
            l.push(lanc(&format!("v{i}"), "2025-10-05", "despesa", "mercado", None));
        }
        for i in 0..3 {
            l.push(lanc(&format!("e{i}"), "2026-11-19", "despesa", "educacao", None));
        }
        for i in 0..30 {
            l.push(lanc(&format!("p{i}"), "2026-11-01", "despesa", "transferencias_pix", None));
        }
        l.push(lanc("borda", "2025-11-19", "despesa", "educacao", None)); // exatamente 12 meses: fora
        l.push(lanc("receita", "2026-11-01", "receita", "educacao", None)); // não é despesa: não conta
        let cats = json!({ "categorias": [{ "id": "p_pet", "nome": "Pet" }], "ocultas": ["lazer"] });
        let u = uso_antigo(&cats, &movs_de(l), HOJE);
        let m = u.iter().find(|c| c.id == "mercado").unwrap();
        assert_eq!((m.nome.as_str(), m.usos, m.marcada), ("Mercado", 16, true));
        let e = u.iter().find(|c| c.id == "educacao").unwrap();
        assert_eq!((e.nome.as_str(), e.usos, e.marcada), ("Educação", 3, false));
        assert_eq!(u[0].id, "mercado", "maior uso primeiro");
        assert_eq!(u[1].id, "educacao");
        let ids: Vec<&str> = u.iter().map(|c| c.id.as_str()).collect();
        for fora in ["transferencias_pix", "transferencias", "investimentos", "emprestimos", "salario", "outras_receitas", "outros", "a_classificar", "lazer"] {
            assert!(!ids.contains(&fora), "{fora} não deveria aparecer");
        }
        assert!(ids.contains(&"p_pet"), "as próprias aparecem");
        assert!(ids.contains(&"saude"), "fixa de gasto sem uso também aparece");
    }

    #[test]
    fn migrar_mantidas_viram_grupo() {
        let mut cats = json!({});
        let mut movs = movs_de(vec![
            lanc("a", "2026-11-01", "despesa", "mercado", Some("Feira")),
            lanc("b", "2026-11-02", "despesa", "mercado", Some("feira")),
            lanc("c", "2026-11-03", "despesa", "mercado", Some("Atacadão")),
        ]);
        let r = migrar(&mut cats, &mut movs, &["mercado".to_string()], "agora").unwrap();
        assert_eq!(r.grupos, 1);
        assert!(migrado(&cats));
        assert_eq!(cats["migrado_em"], "agora");
        let g = grupos(&cats);
        let m = g.iter().find(|g| g["id"] == "mercado").unwrap();
        assert_eq!((m["nome"].as_str(), m["tipo"].as_str(), m["padrao"].as_bool()), (Some("Mercado"), Some("gasto"), Some(false)));
        assert_eq!(m["cor"], "g1");
        assert_eq!(m["pede_pessoa"], false);
        assert_eq!(m["detalhes"], json!(["Feira", "Atacadão"]), "detalhes sem repetir, mais usados primeiro");
        assert_eq!(achar(&movs, "a")["categoria"], "mercado");
        assert_eq!(achar(&movs, "a")["subcategoria"], "Feira");
        assert_eq!(mapa(&cats).get("mercado").map(String::as_str), Some("mercado"));
    }

    #[test]
    fn migrar_desmarcadas_vao_para_outros_com_detalhe() {
        let mut cats = json!({ "categorias": [{ "id": "p_pet", "nome": "Pet" }], "ocultas": ["lazer"] });
        let mut movs = movs_de(vec![
            lanc("a", "2026-11-01", "despesa", "educacao", None),
            lanc("b", "2026-11-01", "despesa", "educacao", Some("curso")),
            lanc("c", "2026-11-01", "despesa", "p_pet", None),
            lanc("d", "2026-11-01", "despesa", "lazer", None),
            lanc("t", "2026-11-01", "transferencia_interna", "transferencias", Some("entre suas contas")),
        ]);
        let r = migrar(&mut cats, &mut movs, &[], "agora").unwrap();
        assert_eq!((r.grupos, r.movidos), (0, 4));
        assert_eq!((achar(&movs, "a")["categoria"].as_str(), achar(&movs, "a")["subcategoria"].as_str()), (Some("outros"), Some("Educação")));
        let b = achar(&movs, "b");
        assert_eq!((b["categoria"].as_str(), b["subcategoria"].as_str(), b["detalhe_antigo"].as_str()), (Some("outros"), Some("Educação"), Some("curso")), "nome antigo é o detalhe; o detalhe de antes fica guardado");
        assert_eq!(achar(&movs, "c")["subcategoria"], "Pet", "própria desmarcada leva o nome dela");
        assert_eq!(achar(&movs, "d")["subcategoria"], "Lazer", "oculta com lançamentos vai para outros");
        assert_eq!(achar(&movs, "t")["categoria"], "transferencias", "categorias do sistema não mudam");
        assert!(!mapa(&cats).contains_key("educacao"));
    }

    #[test]
    fn migrar_detalhe_antigo_por_chave_e_sem_sobrescrever() {
        let mut cats = json!({});
        let mut ja = lanc("j", "2026-11-01", "despesa", "lazer", Some("cinema"));
        ja["detalhe_antigo"] = json!("guardado antes");
        let mut movs = movs_de(vec![
            lanc("p", "2026-11-01", "despesa", "transferencias_pix", Some("pix no cartão")),
            lanc("e", "2026-11-01", "estorno", "compras", Some("devolução")),
            lanc("i", "2026-11-01", "receita", "investimentos", Some("cdb")),
            ja,
        ]);
        migrar(&mut cats, &mut movs, &[], "agora").unwrap();
        let p = achar(&movs, "p");
        assert_eq!((p["subcategoria"].as_str(), p.get("detalhe_antigo").and_then(Value::as_str)), (Some("Pix no cartão"), None), "mesma chave: não guarda");
        let e = achar(&movs, "e");
        assert_eq!((e["categoria"].as_str(), e["subcategoria"].as_str(), e["detalhe_antigo"].as_str()), (Some("rendimentos_estornos"), Some("Estorno"), Some("devolução")));
        let i = achar(&movs, "i");
        assert_eq!((i["subcategoria"].as_str(), i["detalhe_antigo"].as_str()), (Some("Rendimentos"), Some("cdb")));
        let j = achar(&movs, "j");
        assert_eq!((j["subcategoria"].as_str(), j["detalhe_antigo"].as_str()), (Some("Lazer"), Some("guardado antes")), "não sobrescreve");
    }

    #[test]
    fn depois_de_migrar_sugere_os_nomes_antigos() {
        let mut cats = json!({});
        let mut l = vec![];
        for i in 0..3 {
            l.push(lanc(&format!("a{i}"), "2026-11-01", "despesa", "alimentacao", Some("fora de casa")));
            l.push(lanc(&format!("t{i}"), "2026-11-02", "despesa", "transporte", Some("combustível")));
            l.push(lanc(&format!("p{i}"), "2026-11-03", "despesa", "transferencias_pix", Some("pix no cartão")));
        }
        let mut movs = movs_de(l);
        migrar(&mut cats, &mut movs, &[], "2026-11-19").unwrap();
        let mut s: Vec<String> = sugestoes(&cats, &movs, HOJE).iter().map(|x| x["detalhe"].as_str().unwrap().to_string()).collect();
        s.sort();
        assert_eq!(s, ["Alimentação", "Pix no cartão", "Transporte"]);
    }

    #[test]
    fn sugestoes_agrupam_por_chave() {
        let mut c = cats_v2();
        let mut m = movs_de(vec![
            lanc("a", "2026-11-01", "despesa", "outros", Some("pix no cartão")),
            lanc("b", "2026-11-02", "despesa", "outros", Some("pix no cartão")),
            lanc("c", "2026-11-03", "despesa", "outros", Some("Pix no cartão")),
            lanc("d", "2026-11-04", "despesa", "outros", Some("uber")),
            lanc("e", "2026-11-05", "despesa", "outros", Some("UBER")),
        ]);
        let s = sugestoes(&c, &m, HOJE);
        assert_eq!(s.len(), 1, "{s:?}");
        assert_eq!(s[0]["detalhe"], "Pix no cartão", "rótulo com maiúscula");
        assert_eq!(s[0]["lancamentos"].as_array().unwrap().len(), 3);
        let mut n = novo("Pix no cartão", "gasto", "g1");
        n.absorver_detalhe = Some("Pix no cartão".into());
        let (_, movidos) = criar_grupo(&mut c, &mut m, &n, "agora", HOJE).unwrap();
        assert_eq!(movidos, 3, "leva também os de minúscula");
        assert_eq!(achar(&m, "a")["subcategoria"], "Pix no cartão");
    }

    #[test]
    fn migrar_pix_no_cartao() {
        let mut cats = json!({});
        let mut movs = movs_de(vec![lanc("p", "2026-11-01", "despesa", "transferencias_pix", None)]);
        let r = migrar(&mut cats, &mut movs, &["transferencias_pix".to_string()], "agora").unwrap();
        assert_eq!(r.grupos, 0);
        assert_eq!((achar(&movs, "p")["categoria"].as_str(), achar(&movs, "p")["subcategoria"].as_str()), (Some("outros"), Some("Pix no cartão")));
        assert!(!grupos(&cats).iter().any(|g| g["id"] == "transferencias_pix"));
    }

    #[test]
    fn migrar_receitas_e_estorno() {
        let mut cats = json!({});
        let mut movs = movs_de(vec![
            lanc("s", "2026-11-01", "receita", "salario", None),
            lanc("o", "2026-11-01", "receita", "outras_receitas", None),
            lanc("i", "2026-11-01", "receita", "investimentos", None),
            lanc("ap", "2026-11-01", "aporte_investimento", "investimentos", None),
            lanc("e", "2026-11-01", "estorno", "outros", None),
        ]);
        migrar(&mut cats, &mut movs, &[], "agora").unwrap();
        let par = |id: &str| (achar(&movs, id)["categoria"].as_str().map(String::from), achar(&movs, id)["subcategoria"].as_str().map(String::from));
        assert_eq!(par("s"), (Some("salario".into()), None));
        assert_eq!(par("o"), (Some("outras_entradas".into()), None));
        assert_eq!(par("i"), (Some("rendimentos_estornos".into()), Some("Rendimentos".into())));
        assert_eq!(par("ap").0.as_deref(), Some("investimentos"), "aporte não é entrada");
        assert_eq!(par("e"), (Some("rendimentos_estornos".into()), Some("Estorno".into())));
        let m = mapa(&cats);
        assert_eq!(m.get("salario").map(String::as_str), Some("salario"));
        assert_eq!(m.get("outras_receitas").map(String::as_str), Some("outras_entradas"));
        assert_eq!(m.get("investimentos").map(String::as_str), Some("rendimentos_estornos"));
    }

    #[test]
    fn migrar_preserva_manual_e_nome() {
        let mut cats = json!({});
        let mut l = lanc("a", "2026-11-01", "despesa", "educacao", None);
        l["classificacao"] = json!("manual");
        l["nome"] = json!("Feira");
        let mut movs = movs_de(vec![l]);
        migrar(&mut cats, &mut movs, &[], "agora").unwrap();
        assert_eq!(achar(&movs, "a")["classificacao"], "manual");
        assert_eq!(achar(&movs, "a")["nome"], "Feira");
    }

    #[test]
    fn migrar_duas_vezes_e_conflito() {
        let mut cats = json!({});
        let mut movs = movs_de(vec![lanc("a", "2026-11-01", "despesa", "educacao", None), lanc("b", "2026-11-01", "despesa", "mercado", None)]);
        migrar(&mut cats, &mut movs, &["mercado".to_string()], "agora").unwrap();
        let (cats_1, movs_1) = (cats.clone(), movs.clone());
        let r = migrar(&mut cats, &mut movs, &[], "depois");
        assert!(matches!(r, Err(Falha::Conflito(_))));
        assert_eq!(movs, movs_1);
        assert_eq!(cats, cats_1);
    }

    #[test]
    fn categoria_final_usa_mapa() {
        let cats = json!({
            "versao": 2,
            "grupos": [
                { "id": "p_assinaturas", "nome": "Assinaturas", "tipo": "gasto", "cor": "g1", "detalhes": [], "pede_pessoa": false, "padrao": false },
                { "id": "p_carro", "nome": "Carro", "tipo": "gasto", "cor": "g2", "detalhes": [], "pede_pessoa": false, "padrao": false }
            ],
            "mapa": { "assinaturas": "p_assinaturas" }
        });
        let m = mapa(&cats);
        assert_eq!(categoria_final(&m, "despesa", "assinaturas"), "p_assinaturas");
        assert_eq!(categoria_final(&m, "despesa", "lazer"), "a_classificar");
        assert_eq!(categoria_final(&m, "estorno", "outros"), "rendimentos_estornos");
        assert_eq!(categoria_final(&m, "despesa", "p_carro"), "p_carro");
        assert_eq!(categoria_final(&m, "despesa", "outros"), "outros", "padrão é grupo");
        assert_eq!(categoria_final(&m, "despesa", "p_sumiu"), "a_classificar");
        assert_eq!(categoria_final(&m, "receita", "outras_receitas"), "a_classificar", "sem entrada no mapa");
        // Outras naturezas não são gasto nem entrada: a categoria fica como está.
        assert_eq!(categoria_final(&m, "aporte_investimento", "investimentos"), "investimentos");
        assert_eq!(categoria_final(&m, "transferencia_interna", "pagamento_fatura_cartao"), "pagamento_fatura_cartao");
        assert_eq!(categoria_final(&m, "emprestimo_recebido", "emprestimos"), "emprestimos");
        // Sem migrar, o mapa é vazio e nada muda.
        let vazio = mapa(&json!({ "categorias": [] }));
        assert!(vazio.is_empty());
        assert_eq!(categoria_final(&vazio, "despesa", "lazer"), "lazer");
        assert_eq!(categoria_final(&vazio, "estorno", "outros"), "outros");
    }

    #[test]
    fn migrar_nao_deixa_chave_orfa() {
        let mut cats = json!({ "categorias": [{ "id": "p_pet", "nome": "Pet" }] });
        let mut movs = movs_de(vec![
            lanc("tr", "2026-11-01", "despesa", "transferencias", None),
            lanc("sa", "2026-11-01", "despesa", "salario", None),
            lanc("em", "2026-11-01", "despesa", "emprestimos", Some("parcela")),
            lanc("xx", "2026-11-01", "despesa", "chave_estranha", None),
            lanc("me", "2026-11-01", "receita", "mercado", None),
            lanc("pe", "2026-11-01", "receita", "p_pet", None),
            lanc("ac", "2026-11-01", "despesa", "a_classificar", None),
            lanc("ap", "2026-11-01", "aporte_investimento", "investimentos", None),
        ]);
        migrar(&mut cats, &mut movs, &[], "agora").unwrap();
        let par = |id: &str| (achar(&movs, id)["categoria"].as_str().unwrap().to_string(), achar(&movs, id)["subcategoria"].as_str().map(String::from));
        assert_eq!(par("tr"), ("outros".into(), Some("Transferências".into())));
        assert_eq!(par("sa"), ("outros".into(), Some("Salário".into())));
        assert_eq!(par("em"), ("outros".into(), Some("Empréstimos".into())));
        assert_eq!(achar(&movs, "em")["detalhe_antigo"], "parcela");
        assert_eq!(par("xx"), ("outros".into(), Some("chave_estranha".into())));
        assert_eq!(par("me"), ("outras_entradas".into(), Some("Mercado".into())));
        assert_eq!(par("pe"), ("outras_entradas".into(), Some("Pet".into())));
        assert_eq!(par("ac"), ("a_classificar".into(), None));
        assert_eq!(par("ap").0, "investimentos");
        let m = mapa(&cats);
        for k in ["transferencias", "transferencias_pix", "emprestimos"] {
            assert_eq!(m.get(k).map(String::as_str), Some("outros"), "{k}");
        }

        // "mercado" mantido como grupo de gasto: a receita dele também não pode ficar lá.
        let mut cats = json!({});
        let mut movs = movs_de((0..15).map(|i| lanc(&format!("m{i}"), "2026-11-01", "despesa", "mercado", None)).chain([lanc("rm", "2026-11-01", "receita", "mercado", None)]).collect());
        migrar(&mut cats, &mut movs, &["mercado".to_string()], "2026-11-19").unwrap();
        assert_eq!(achar(&movs, "m0")["categoria"], "mercado");
        assert_eq!((achar(&movs, "rm")["categoria"].as_str(), achar(&movs, "rm")["subcategoria"].as_str()), (Some("outras_entradas"), Some("Mercado")));
    }

    #[test]
    fn traducao_deixa_o_nome_antigo_como_detalhe() {
        let mut cats = json!({});
        migrar(&mut cats, &mut json!({}), &[], "agora").unwrap();
        let m = mapa(&cats);
        let t = |n: &str, c: &str| traducao(&m, n, c);
        assert_eq!(t("despesa", "transferencias"), ("outros".into(), Some("Transferências".into())));
        assert_eq!(t("despesa", "transferencias_pix"), ("outros".into(), Some("Pix no cartão".into())));
        assert_eq!(t("receita", "investimentos"), ("rendimentos_estornos".into(), Some("Rendimentos".into())));
        assert_eq!(t("estorno", "compras"), ("rendimentos_estornos".into(), Some("Estorno".into())));
        assert_eq!(t("receita", "outras_receitas"), ("outras_entradas".into(), None));
        assert_eq!(t("receita", "salario"), ("salario".into(), None));
        assert_eq!(t("receita", "emprestimos"), ("a_classificar".into(), None));
        assert_eq!(t("despesa", "outros"), ("outros".into(), None));
        assert_eq!(t("despesa", "lazer"), ("a_classificar".into(), None));
        assert_eq!(traducao(&HashMap::new(), "despesa", "transferencias"), ("transferencias".into(), None));
    }

    #[test]
    fn mudar_natureza_solta_grupo_de_outro_tipo() {
        let mut m = json!({ "natureza": "despesa", "categoria": "outros", "subcategoria": "Pix", "classificacao": "manual" });
        let v1 = json!({});
        let mut x = m.clone();
        ajustar_a_natureza(&v1, &mut x, "receita");
        assert_eq!((x["natureza"].as_str(), x["categoria"].as_str()), (Some("receita"), Some("outros")), "sem migrar não mexe na categoria");
        let mut cats = json!({});
        migrar(&mut cats, &mut json!({}), &[], "agora").unwrap();
        ajustar_a_natureza(&cats, &mut m, "transferencia_interna");
        assert_eq!((m["categoria"].as_str(), m["subcategoria"].as_str(), m["classificacao"].as_str()), (Some("a_classificar"), None, Some("baixa")));
        let mut e = json!({ "natureza": "receita", "categoria": "rendimentos_estornos", "subcategoria": "Venda" });
        ajustar_a_natureza(&cats, &mut e, "estorno");
        assert_eq!((e["categoria"].as_str(), e["subcategoria"].as_str()), (Some("rendimentos_estornos"), Some("Venda")), "entrada serve para estorno");
    }

    #[test]
    fn existe_aceita_grupo_quando_migrado() {
        let mut cats = json!({});
        let mut movs = json!({ "movimentacoes": [] });
        assert!(existe(&cats, "lazer"));
        assert!(!existe(&cats, "rendimentos_estornos"));
        migrar(&mut cats, &mut movs, &[], "2026-11-19T10:00:00-03:00").unwrap();
        assert!(existe(&cats, "rendimentos_estornos"));
        assert!(existe(&cats, "outros"));
        assert!(existe(&cats, "a_classificar"));
        assert!(!existe(&cats, "lazer"), "chave antiga sem grupo");
    }

    #[test]
    fn tipo_do_grupo_confere_com_natureza() {
        let mut cats = json!({});
        assert!(conferir_tipo(&cats, "salario", "despesa").is_ok(), "sem migrar não confere");
        migrar(&mut cats, &mut json!({}), &[], "2026-11-19T10:00:00-03:00").unwrap();
        assert!(conferir_tipo(&cats, "outros", "despesa").is_ok());
        assert!(conferir_tipo(&cats, "salario", "receita").is_ok());
        assert!(conferir_tipo(&cats, "rendimentos_estornos", "estorno").is_ok());
        assert!(conferir_tipo(&cats, "a_classificar", "transferencia_interna").is_ok());
        let msg = |r: Result<(), Falha>| match r {
            Err(Falha::Invalido(m)) => m,
            _ => String::new(),
        };
        assert_eq!(msg(conferir_tipo(&cats, "salario", "despesa")), "essa categoria é de entradas");
        assert_eq!(msg(conferir_tipo(&cats, "outros", "estorno")), "essa categoria é de gastos");
        assert_eq!(msg(conferir_tipo(&cats, "outros", "transferencia_interna")), "essa categoria é de gastos");
    }

    #[test]
    fn grupos_em_ordem_e_padroes_sem_migrar() {
        assert!(!migrado(&json!({})));
        let ids: Vec<String> = grupos(&json!({})).iter().map(|g| g["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(ids, ["outros", "salario", "renda_extra", "pix_pessoas", "rendimentos_estornos", "outras_entradas"]);
        let cats = json!({ "versao": 2, "grupos": [
            { "id": "p_viagem", "nome": "Viagem", "tipo": "gasto", "cor": "g1", "detalhes": [], "pede_pessoa": false, "padrao": false },
            { "id": "p_academia", "nome": "Ácademia", "tipo": "gasto", "cor": "g2", "detalhes": [], "pede_pessoa": false, "padrao": false },
            { "id": "p_aluguel", "nome": "Aluguel recebido", "tipo": "entrada", "cor": "g3", "detalhes": [], "pede_pessoa": false, "padrao": false },
            { "id": "outros", "nome": "Outro nome", "tipo": "gasto", "cor": "g5", "detalhes": ["Pix"], "pede_pessoa": false, "padrao": true }
        ]});
        let g = grupos(&cats);
        let ids: Vec<&str> = g.iter().map(|g| g["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["p_academia", "p_viagem", "outros", "salario", "renda_extra", "pix_pessoas", "rendimentos_estornos", "p_aluguel", "outras_entradas"]);
        let outros = &g[2];
        assert_eq!((outros["nome"].as_str(), outros["cor"].as_str(), outros["padrao"].as_bool()), (Some("Outros gastos"), Some("g5"), Some(true)), "padrão guarda cor e detalhes, nunca o nome");
        assert_eq!(g.iter().find(|g| g["id"] == "rendimentos_estornos").unwrap()["detalhes"], json!(["Rendimentos", "Estorno", "Venda"]));
    }

    #[test]
    fn migrar_cores_em_ordem_de_uso_e_nome_repetido() {
        // própria "Saude" (sem acento) e fixa "Saúde" mantidas: a segunda ganha " 2"
        let mut cats = json!({ "categorias": [{ "id": "p_saude", "nome": "Saude" }, { "id": "p_renda", "nome": "Renda extra" }] });
        let mut l = vec![];
        for i in 0..3 { l.push(lanc(&format!("s{i}"), "2026-11-01", "despesa", "saude", None)); }
        for i in 0..2 { l.push(lanc(&format!("p{i}"), "2026-11-01", "despesa", "p_saude", None)); }
        l.push(lanc("r", "2026-11-01", "despesa", "p_renda", None));
        let mut movs = movs_de(l);
        let manter: Vec<String> = ["p_renda", "p_saude", "saude", "nao_existe"].iter().map(|s| s.to_string()).collect();
        let r = migrar(&mut cats, &mut movs, &manter, "agora").unwrap();
        assert_eq!(r.grupos, 3);
        let g = grupos(&cats);
        let por = |id: &str| g.iter().find(|g| g["id"] == id).unwrap().clone();
        assert_eq!((por("saude")["cor"].as_str(), por("p_saude")["cor"].as_str(), por("p_renda")["cor"].as_str()), (Some("g1"), Some("g2"), Some("g3")));
        assert_eq!(por("saude")["nome"], "Saúde");
        assert_eq!(por("p_saude")["nome"], "Saude 2");
        assert_eq!(por("p_renda")["nome"], "Renda extra 2", "não repete nome de padrão");
        assert_eq!(achar(&movs, "p0")["categoria"], "p_saude");
    }

    // ---------- Criar, editar, apagar e sugestões ----------

    fn cats_v2() -> Value {
        let mut c = json!({});
        let mut m = movs_de(vec![]);
        migrar(&mut c, &mut m, &[], "agora").unwrap();
        c
    }

    fn novo(nome: &str, tipo: &str, cor: &str) -> NovoGrupo {
        NovoGrupo { nome: nome.into(), tipo: tipo.into(), cor: cor.into(), detalhes: vec![], pede_pessoa: false, absorver_detalhe: None }
    }

    fn invalido(r: Result<(Value, usize), Falha>) -> bool {
        matches!(r, Err(Falha::Invalido(_)))
    }

    #[test]
    fn criar_grupo_valida_nome() {
        let mut c = cats_v2();
        let mut m = movs_de(vec![]);
        for nome in ["", "   ", &"x".repeat(41), "salário", "SALARIO", "  OUTROS   gastos "] {
            assert!(invalido(criar_grupo(&mut c, &mut m, &novo(nome, "gasto", "g1"), "agora", HOJE)), "{nome:?}");
        }
        assert!(invalido(criar_grupo(&mut c, &mut m, &novo("Carro", "gasto", "g9"), "agora", HOJE)));
        assert!(invalido(criar_grupo(&mut c, &mut m, &novo("Carro", "x", "g1"), "agora", HOJE)));
        let mut n = novo("Carro", "gasto", "g1");
        n.detalhes = (0..21).map(|i| format!("d{i}")).collect();
        assert!(invalido(criar_grupo(&mut c, &mut m, &n, "agora", HOJE)));
        n.detalhes = vec!["y".repeat(41)];
        assert!(invalido(criar_grupo(&mut c, &mut m, &n, "agora", HOJE)));
        assert_eq!(grupos(&c).len(), PADRAO.len(), "nada foi criado");
        n.detalhes = vec!["Gasolina".into(), " gasolina ".into(), "".into(), "Seguro".into()];
        let (g, movidos) = criar_grupo(&mut c, &mut m, &n, "agora", HOJE).unwrap();
        assert_eq!((g["id"].as_str(), g["detalhes"].clone(), movidos), (Some("p_carro"), json!(["Gasolina", "Seguro"]), 0));
        assert!(invalido(criar_grupo(&mut c, &mut m, &novo("carro", "gasto", "g1"), "agora", HOJE)), "repetido");
        assert_eq!(mapa(&c).get("p_carro").map(String::as_str), Some("p_carro"));
    }

    #[test]
    fn criar_grupo_nao_migrado_e_id_ocupado() {
        let mut m = movs_de(vec![]);
        let mut c = json!({});
        assert_eq!(criar_grupo(&mut c, &mut m, &novo("Carro", "gasto", "g1"), "agora", HOJE), Err(Falha::Invalido("as categorias ainda não foram migradas".into())));
        assert!(editar_grupo(&mut c, "outros", &novo("x", "gasto", "g1"), "agora").is_err());
        assert!(apagar_grupo(&mut c, &mut m, "p_x", "agora").is_err());
        // "Carro!" e "Carro" têm o mesmo slug mas nomes diferentes
        let mut c = cats_v2();
        let (a, _) = criar_grupo(&mut c, &mut m, &novo("Carro", "gasto", "g1"), "agora", HOJE).unwrap();
        let (b, _) = criar_grupo(&mut c, &mut m, &novo("Carro!", "gasto", "g1"), "agora", HOJE).unwrap();
        assert_eq!((a["id"].as_str(), b["id"].as_str()), (Some("p_carro"), Some("p_carro_2")));
    }

    #[test]
    fn criar_grupo_com_sugestao_absorve() {
        let mut c = cats_v2();
        let mut m = movs_de(vec![
            lanc("a", "2026-10-10", "despesa", "outros", Some("Saúde")),
            lanc("b", "2026-11-01", "despesa", "outros", Some("Saúde")),
            lanc("c", "2026-11-05", "despesa", "outros", Some("Saúde")),
            lanc("d", "2026-01-05", "despesa", "outros", Some("Saúde")),
            lanc("e", "2026-11-05", "despesa", "outros", Some("Uber")),
            lanc("f", "2026-11-05", "despesa", "mercado", Some("Saúde")),
        ]);
        let mut n = novo("Saúde", "gasto", "g3");
        n.absorver_detalhe = Some("Saúde".into());
        let (g, movidos) = criar_grupo(&mut c, &mut m, &n, "agora", HOJE).unwrap();
        assert_eq!(movidos, 4);
        assert_eq!(g["id"], "p_saude");
        assert_eq!(g["detalhes"], json!(["Saúde"]));
        for id in ["a", "b", "c", "d"] {
            assert_eq!((achar(&m, id)["categoria"].as_str(), achar(&m, id)["subcategoria"].as_str()), (Some("p_saude"), Some("Saúde")));
        }
        assert_eq!(achar(&m, "e")["categoria"], "outros");
        assert_eq!(achar(&m, "f")["categoria"], "mercado");
        // entrada não absorve
        let mut m = movs_de(vec![lanc("a", "2026-10-10", "despesa", "outros", Some("Bônus"))]);
        let mut n = novo("Bônus", "entrada", "g2");
        n.absorver_detalhe = Some("Bônus".into());
        assert_eq!(criar_grupo(&mut c, &mut m, &n, "agora", HOJE).unwrap().1, 0);
        assert_eq!(achar(&m, "a")["categoria"], "outros");
    }

    #[test]
    fn criar_grupo_absorve_partes_com_o_detalhe() {
        let mut c = cats_v2();
        let mut m = movs_de(vec![lanc("a", "2026-10-10", "despesa", "outros", None)]);
        m["movimentacoes"][0]["valor"] = json!(-30.0);
        m["movimentacoes"][0]["partes"] = json!([{ "valor": -10.0, "categoria": "outros" }, { "valor": -20.0, "categoria": "outros", "subcategoria": "Farmácia" }]);
        m["movimentacoes"][0]["subcategoria"] = json!("Farmácia");
        let mut n = novo("Saúde", "gasto", "g1");
        n.absorver_detalhe = Some("farmácia".into());
        let (g, movidos) = criar_grupo(&mut c, &mut m, &n, "agora", HOJE).unwrap();
        assert_eq!(movidos, 1);
        let a = achar(&m, "a");
        assert_eq!(a["partes"][1], json!({ "valor": -20.0, "categoria": g["id"], "subcategoria": "farmácia" }));
        assert_eq!(a["partes"][0]["categoria"], "outros");
        assert_eq!(a["categoria"], g["id"], "a principal (maior parte) foi para o grupo novo");
        assert_eq!(a["subcategoria"], "farmácia");
    }

    #[test]
    fn apagar_grupo_leva_as_partes_junto() {
        let mut c = cats_v2();
        let mut m = movs_de(vec![lanc("a", "2026-10-10", "despesa", "outros", None)]);
        criar_grupo(&mut c, &mut m, &novo("Carro", "gasto", "g1"), "agora", HOJE).unwrap();
        m["movimentacoes"][0]["valor"] = json!(-30.0);
        m["movimentacoes"][0]["partes"] = json!([{ "valor": -20.0, "categoria": "outros" }, { "valor": -10.0, "categoria": "p_carro", "subcategoria": "Pneu" }]);
        assert_eq!(apagar_grupo(&mut c, &mut m, "p_carro", "agora"), Ok(1));
        let a = achar(&m, "a");
        assert_eq!(a["partes"], json!([{ "valor": -20.0, "categoria": "outros" }, { "valor": -10.0, "categoria": "outros", "subcategoria": "Carro", "detalhe_antigo": "Pneu" }]));
        assert_eq!(a["categoria"], "outros", "a categoria principal não era o grupo apagado");
    }

    #[test]
    fn apagar_grupo_devolve_para_outros() {
        let mut c = cats_v2();
        let mut m = movs_de(vec![
            lanc("a", "2026-10-10", "despesa", "p_carro", None),
            lanc("b", "2026-10-11", "despesa", "p_carro", Some("Gasolina")),
            lanc("c", "2026-10-11", "despesa", "mercado", None),
        ]);
        criar_grupo(&mut c, &mut m, &novo("Carro", "gasto", "g1"), "agora", HOJE).unwrap();
        c["mapa"]["carro_antigo"] = json!("p_carro");
        assert_eq!(apagar_grupo(&mut c, &mut m, "p_carro", "agora"), Ok(2));
        assert_eq!((achar(&m, "a")["categoria"].as_str(), achar(&m, "a")["subcategoria"].as_str()), (Some("outros"), Some("Carro")));
        let b = achar(&m, "b");
        assert_eq!((b["subcategoria"].as_str(), b["detalhe_antigo"].as_str()), (Some("Carro"), Some("Gasolina")));
        // detalhe_antigo que já existia não é sobrescrito
        let mut m2 = movs_de(vec![lanc("y", "2026-10-10", "despesa", "p_moto", Some("Pneu"))]);
        m2["movimentacoes"][0]["detalhe_antigo"] = json!("Educação");
        criar_grupo(&mut c, &mut m2, &novo("Moto", "gasto", "g2"), "agora", HOJE).unwrap();
        apagar_grupo(&mut c, &mut m2, "p_moto", "agora").unwrap();
        let y = achar(&m2, "y");
        assert_eq!((y["subcategoria"].as_str(), y["detalhe_antigo"].as_str()), (Some("Moto"), Some("Educação")));
        assert_eq!(achar(&m, "c")["categoria"], "mercado");
        assert!(!grupos(&c).iter().any(|g| g["id"] == "p_carro"));
        assert!(!mapa(&c).contains_key("carro_antigo"));
        assert!(matches!(apagar_grupo(&mut c, &mut m, "outros", "agora"), Err(Falha::Invalido(_))));
        assert!(matches!(apagar_grupo(&mut c, &mut m, "salario", "agora"), Err(Falha::Invalido(_))));
        assert_eq!(apagar_grupo(&mut c, &mut m, "p_carro", "agora"), Err(Falha::NaoEncontrado("grupo não encontrado")));
        // grupo de entrada volta para outras_entradas
        let mut m = movs_de(vec![lanc("x", "2026-10-10", "receita", "p_aluguel", None)]);
        criar_grupo(&mut c, &mut m, &novo("Aluguel", "entrada", "g2"), "agora", HOJE).unwrap();
        assert_eq!(apagar_grupo(&mut c, &mut m, "p_aluguel", "agora"), Ok(1));
        assert_eq!(achar(&m, "x")["categoria"], "outras_entradas");
    }

    #[test]
    fn criar_grupo_com_nome_antigo_entra_no_mapa() {
        let mut c = json!({ "categorias": [{ "id": "p_pet", "nome": "Pet" }] });
        let mut m = movs_de((0..15).map(|i| lanc(&format!("s{i}"), "2026-11-01", "despesa", "saude", None)).collect());
        migrar(&mut c, &mut m, &["saude".to_string()], "2026-11-19").unwrap();
        let (t, _) = criar_grupo(&mut c, &mut m, &novo("transporte", "gasto", "g1"), "agora", HOJE).unwrap();
        let mut n = novo("Alimentacao", "gasto", "g2");
        n.absorver_detalhe = Some("Alimentação".into());
        let (a, _) = criar_grupo(&mut c, &mut m, &n, "agora", HOJE).unwrap();
        criar_grupo(&mut c, &mut m, &novo("PET", "gasto", "g3"), "agora", HOJE).unwrap();
        criar_grupo(&mut c, &mut m, &novo("Saúde e bem-estar", "gasto", "g4"), "agora", HOJE).unwrap();
        criar_grupo(&mut c, &mut m, &novo("Lazer", "entrada", "g5"), "agora", HOJE).unwrap();
        criar_grupo(&mut c, &mut m, &novo("Transferências", "gasto", "g6"), "agora", HOJE).unwrap();
        let mp = mapa(&c);
        assert_eq!(mp.get("transporte"), t["id"].as_str().map(String::from).as_ref());
        assert_eq!(mp.get("alimentacao"), a["id"].as_str().map(String::from).as_ref());
        assert_eq!(categoria_final(&mp, "despesa", "transporte"), "p_transporte");
        assert!(mp.contains_key("p_pet"), "própria antiga também");
        assert_eq!(mp.get("saude").map(String::as_str), Some("saude"), "já estava no mapa: não muda");
        assert!(!mp.contains_key("lazer"), "grupo de entrada não pega chave de gasto");
        assert_eq!(mp.get("transferencias").map(String::as_str), Some("outros"), "já estava no mapa");
    }

    #[test]
    fn editar_padrao_so_detalhes_e_cor() {
        let mut c = cats_v2();
        let mut n = novo("Pagamento", "gasto", "g5");
        n.detalhes = vec!["Mensal".into()];
        n.pede_pessoa = true;
        let g = editar_grupo(&mut c, "salario", &n, "agora").unwrap();
        assert_eq!((g["nome"].as_str(), g["cor"].as_str(), g["tipo"].as_str(), g["pede_pessoa"].as_bool()), (Some("Salário"), Some("g5"), Some("entrada"), Some(false)));
        let g = grupos(&c).into_iter().find(|g| g["id"] == "salario").unwrap();
        assert_eq!((g["cor"].as_str(), g["detalhes"].clone()), (Some("g5"), json!(["Mensal"])));
        assert_eq!(editar_grupo(&mut c, "p_nada", &n, "agora"), Err(Falha::NaoEncontrado("grupo não encontrado")));
    }

    #[test]
    fn editar_grupo_proprio() {
        let mut c = cats_v2();
        let mut m = movs_de(vec![]);
        criar_grupo(&mut c, &mut m, &novo("Carro", "gasto", "g1"), "agora", HOJE).unwrap();
        criar_grupo(&mut c, &mut m, &novo("Pet", "gasto", "g2"), "agora", HOJE).unwrap();
        let mut n = novo("Carro", "gasto", "g4");
        n.pede_pessoa = true;
        let g = editar_grupo(&mut c, "p_carro", &n, "agora").unwrap();
        assert_eq!((g["nome"].as_str(), g["cor"].as_str(), g["pede_pessoa"].as_bool()), (Some("Carro"), Some("g4"), Some(true)), "mesmo nome é aceito");
        n.nome = "pet".into();
        assert!(matches!(editar_grupo(&mut c, "p_carro", &n, "agora"), Err(Falha::Invalido(_))));
        n.nome = "Automóvel".into();
        let g = editar_grupo(&mut c, "p_carro", &n, "agora").unwrap();
        assert_eq!((g["id"].as_str(), g["nome"].as_str()), (Some("p_carro"), Some("Automóvel")));
        n.cor = "g0".into();
        assert!(editar_grupo(&mut c, "p_carro", &n, "agora").is_err());
    }

    #[test]
    fn sugestoes_minimo_3_em_90_dias() {
        let mut c = cats_v2();
        let mut l = vec![];
        for (i, d) in ["2026-10-10", "2026-11-05", "2026-11-18"].iter().enumerate() {
            l.push(lanc(&format!("s{i}"), d, "despesa", "outros", Some("Saúde")));
        }
        for i in 0..2 {
            l.push(lanc(&format!("u{i}"), "2026-11-10", "despesa", "outros", Some("Uber")));
        }
        for i in 0..3 {
            l.push(lanc(&format!("f{i}"), "2026-06-10", "despesa", "outros", Some("Farmácia")));
        }
        for i in 0..3 {
            l.push(lanc(&format!("c{i}"), "2026-11-10", "despesa", "outros", Some("Carro")));
        }
        for i in 0..3 {
            l.push(lanc(&format!("m{i}"), "2026-11-10", "despesa", "mercado", Some("Feira")));
        }
        let mut m = movs_de(l);
        m["movimentacoes"][0]["valor"] = json!(-50.0);
        let mut n = novo("carro", "gasto", "g1");
        n.nome = "Carro".into();
        criar_grupo(&mut c, &mut m, &n, "agora", HOJE).unwrap();
        // "Carro" já é grupo (os 3 lançamentos nem sobram em outros, mas o nome vale mesmo assim)
        let s = sugestoes(&c, &m, HOJE);
        assert_eq!(s.len(), 1, "{s:?}");
        assert_eq!(s[0]["detalhe"], "Saúde");
        assert_eq!(s[0]["lancamentos"], json!(["s2", "s1", "s0"]), "mais recente primeiro");
        assert_eq!(s[0]["total"], 70.0);
        // 90 dias exatos: 2026-08-21 está fora, 2026-08-22 dentro
        let mut l = vec![];
        for (i, d) in ["2026-08-21", "2026-08-22", "2026-09-01", "2026-09-02"].iter().enumerate() {
            l.push(lanc(&format!("z{i}"), d, "despesa", "outros", Some("Zelador")));
        }
        assert_eq!(sugestoes(&c, &movs_de(l), HOJE)[0]["lancamentos"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn sugestoes_maior_total_primeiro() {
        let c = cats_v2();
        let mut l = vec![];
        for i in 0..3 {
            l.push(lanc(&format!("a{i}"), "2026-11-10", "despesa", "outros", Some("Barato")));
            let mut x = lanc(&format!("b{i}"), "2026-11-10", "despesa", "outros", Some("Caro"));
            x["valor"] = json!(-100.0);
            l.push(x);
        }
        let s = sugestoes(&c, &movs_de(l), HOJE);
        assert_eq!((s[0]["detalhe"].as_str(), s[1]["detalhe"].as_str()), (Some("Caro"), Some("Barato")));
    }
}
