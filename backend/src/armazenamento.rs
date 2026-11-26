//! Onde os dados ficam guardados.
//!
//! - `Pasta`: arquivos JSON numa pasta local (uso no próprio computador).
//! - `Postgres`: cada arquivo vira uma linha JSONB (uso online, ex.: Neon).
//!
//! Os dois guardam também os documentos originais (PDF, OFX…) e uma cópia de cada
//! arquivo antes de ser regravado, para dar para voltar atrás.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;

use crate::modelo::*;

pub const ARQUIVOS: [(&str, &str, &str); 14] = [
    ("config", "Contas e preferências", "contas"),
    ("holerites", "Holerites", "holerites"),
    ("movimentacoes", "Extratos e faturas", "movimentacoes"),
    ("categorias", "Categorias criadas por você", "categorias"),
    ("dividas", "Dívidas", "dividas"),
    ("emprestimos", "Empréstimos entre pessoas", "emprestimos"),
    ("investimentos", "Investimentos", "investimentos"),
    ("metas", "Metas", "metas"),
    ("fixas", "Contas fixas e assinaturas", "fixas"),
    ("orcamentos", "Limites de gasto por categoria", "limites"),
    ("indicadores", "Selic e CDI (BCB)", "series"),
    ("documentos", "Documentos processados", "documentos"),
    ("sincronizacoes", "Sincronizações com o banco (Open Finance)", "execucoes"),
    ("avisos", "Avisos no celular", "aparelhos"),
];

/// Arquivos que ficam só no servidor: guardam a chave privada VAPID e os endereços dos aparelhos.
/// Não saem por `/api/dados`, pelas fontes nem pela cópia de segurança.
const RESERVADOS: [&str; 1] = ["avisos"];

/// Quantas versões anteriores de cada arquivo guardar.
const VERSOES_GUARDADAS: i64 = 30;

pub fn arquivo_valido(nome: &str) -> bool {
    ARQUIVOS.iter().any(|(n, _, _)| *n == nome)
}

/// Arquivo que a API pode mostrar e que entra na cópia de segurança.
pub fn arquivo_publico(nome: &str) -> bool {
    arquivo_valido(nome) && !RESERVADOS.contains(&nome)
}

#[derive(Debug, Clone, Serialize)]
pub struct Fonte {
    pub arquivo: String,
    pub descricao: String,
    pub existe: bool,
    pub registros: Option<usize>,
    pub atualizado_em: Option<String>,
    pub erro: Option<String>,
}

#[derive(Clone)]
pub enum Armazenamento {
    Pasta(PathBuf),
    Postgres(PgPool),
}

impl Armazenamento {
    pub async fn postgres(url: &str) -> Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(std::time::Duration::from_secs(30))
            .connect(url)
            .await
            .context("conectando ao Postgres (DATABASE_URL)")?;
        for sql in [
            "create table if not exists arquivos (
                nome text primary key,
                conteudo jsonb not null,
                atualizado_em timestamptz not null default now())",
            "create table if not exists arquivos_versoes (
                id bigserial primary key,
                nome text not null,
                conteudo jsonb not null,
                guardado_em timestamptz not null default now())",
            "create index if not exists arquivos_versoes_nome on arquivos_versoes (nome, id desc)",
            "create table if not exists originais (
                sha256 text primary key,
                nome_original text not null,
                tipo_conteudo text,
                conteudo bytea not null,
                recebido_em timestamptz not null default now())",
        ] {
            sqlx::query(sql).execute(&pool).await?;
        }
        Ok(Armazenamento::Postgres(pool))
    }

    pub fn pasta(dir: impl Into<PathBuf>) -> Result<Self> {
        let dir = dir.into();
        preparar_pasta(&dir)?;
        Ok(Armazenamento::Pasta(dir))
    }

    pub fn descricao(&self) -> String {
        match self {
            Armazenamento::Pasta(d) => format!("pasta {}", d.display()),
            Armazenamento::Postgres(_) => "banco Postgres".into(),
        }
    }

    pub async fn ler_valor(&self, nome: &str) -> Result<Option<Value>> {
        if !arquivo_valido(nome) {
            bail!("arquivo desconhecido: {nome}");
        }
        match self {
            Armazenamento::Pasta(dir) => {
                let p = dir.join(format!("{nome}.json"));
                if !p.exists() {
                    return Ok(None);
                }
                let txt = std::fs::read_to_string(&p).with_context(|| format!("lendo {}", p.display()))?;
                Ok(Some(serde_json::from_str(&txt).with_context(|| format!("JSON inválido em {}", p.display()))?))
            }
            Armazenamento::Postgres(pool) => {
                let linha = sqlx::query("select conteudo from arquivos where nome = $1")
                    .bind(nome)
                    .fetch_optional(pool)
                    .await?;
                Ok(linha.map(|l| l.get::<Value, _>(0)))
            }
        }
    }

    pub async fn ler_json(&self, nome: &str) -> Result<Value> {
        Ok(self.ler_valor(nome).await?.unwrap_or(Value::Null))
    }

    async fn ler<T: DeserializeOwned + Default>(&self, nome: &str) -> Result<T> {
        match self.ler_valor(nome).await? {
            None => Ok(T::default()),
            Some(v) => serde_json::from_value(v).with_context(|| format!("{nome}.json fora do formato esperado")),
        }
    }

    /// Como `ler`, mas só com o que veio de documentos (sem a sincronização com o banco).
    async fn ler_documentos<T: DeserializeOwned + Default>(&self, nome: &str) -> Result<T> {
        match self.ler_valor(nome).await? {
            None => Ok(T::default()),
            Some(mut v) => {
                crate::fonte::so_documentos(nome, &mut v);
                serde_json::from_value(v).with_context(|| format!("{nome}.json fora do formato esperado"))
            }
        }
    }

    /// Dados do "modelo antigo": só holerites, faturas e extratos enviados por você.
    pub async fn carregar_documentos(&self) -> Result<Dados> {
        let mut d = self.carregar().await?;
        d.movimentacoes = self.ler_documentos("movimentacoes").await?;
        d.dividas = self.ler_documentos("dividas").await?;
        Ok(d)
    }

    pub async fn carregar(&self) -> Result<Dados> {
        Ok(Dados {
            config: self.ler("config").await?,
            holerites: self.ler("holerites").await?,
            movimentacoes: self.ler("movimentacoes").await?,
            dividas: self.ler("dividas").await?,
            investimentos: self.ler("investimentos").await?,
            metas: self.ler("metas").await?,
            indicadores: self.ler_json("indicadores").await?,
            documentos: self.ler_json("documentos").await?,
        })
    }

    /// Situação de cada arquivo, sem falhar se algum estiver com problema.
    pub async fn fontes(&self) -> Vec<Fonte> {
        let mut out = Vec::new();
        for (nome, descricao, chave) in ARQUIVOS {
            if !arquivo_publico(nome) {
                continue;
            }
            let mut f = Fonte {
                arquivo: format!("{nome}.json"),
                descricao: descricao.to_string(),
                existe: false,
                registros: None,
                atualizado_em: None,
                erro: None,
            };
            match self.ler_valor(nome).await {
                Ok(Some(v)) => {
                    f.existe = true;
                    f.registros = match v.get(chave) {
                        Some(Value::Array(a)) => Some(a.len()),
                        Some(Value::Object(o)) => Some(o.len()),
                        _ => Some(0),
                    };
                    f.atualizado_em = v.get("atualizado_em").and_then(|x| x.as_str()).map(String::from);
                }
                Ok(None) => {}
                Err(e) => f.erro = Some(format!("{e:#}")),
            }
            out.push(f);
        }
        out
    }

    /// Grava um arquivo inteiro, guardando antes a versão anterior.
    pub async fn gravar_valor(&self, nome: &str, valor: &Value) -> Result<()> {
        if !arquivo_valido(nome) {
            bail!("arquivo desconhecido: {nome}");
        }
        match self {
            Armazenamento::Pasta(dir) => {
                std::fs::create_dir_all(dir)?;
                let destino = dir.join(format!("{nome}.json"));
                if destino.exists() {
                    let versoes = dir.join(".versoes");
                    std::fs::create_dir_all(&versoes)?;
                    let carimbo = chrono::Utc::now().format("%Y%m%dT%H%M%S%.3f");
                    std::fs::copy(&destino, versoes.join(format!("{nome}.{carimbo}.json")))?;
                }
                let tmp = dir.join(format!(".{nome}.json.tmp"));
                let mut txt = serde_json::to_string_pretty(valor)?;
                txt.push('\n');
                std::fs::write(&tmp, txt)?;
                std::fs::rename(&tmp, &destino)?;
            }
            Armazenamento::Postgres(pool) => {
                let mut tx = pool.begin().await?;
                sqlx::query(
                    "insert into arquivos_versoes (nome, conteudo) select nome, conteudo from arquivos where nome = $1",
                )
                .bind(nome)
                .execute(&mut *tx)
                .await?;
                sqlx::query(
                    "insert into arquivos (nome, conteudo, atualizado_em) values ($1, $2, now())
                     on conflict (nome) do update set conteudo = excluded.conteudo, atualizado_em = now()",
                )
                .bind(nome)
                .bind(valor)
                .execute(&mut *tx)
                .await?;
                sqlx::query(
                    "delete from arquivos_versoes where nome = $1 and id not in
                     (select id from arquivos_versoes where nome = $1 order by id desc limit $2)",
                )
                .bind(nome)
                .bind(VERSOES_GUARDADAS)
                .execute(&mut *tx)
                .await?;
                tx.commit().await?;
            }
        }
        Ok(())
    }

    /// Guarda o documento original. Devolve `false` se já existia (mesmo SHA-256).
    pub async fn guardar_original(&self, sha256: &str, nome_original: &str, tipo: &str, bytes: &[u8]) -> Result<bool> {
        match self {
            Armazenamento::Pasta(dir) => {
                let pasta = dir.join("originais");
                std::fs::create_dir_all(&pasta)?;
                let ext = Path::new(nome_original).extension().and_then(|e| e.to_str()).unwrap_or("bin").to_lowercase();
                let p = pasta.join(format!("{sha256}.{ext}"));
                if p.exists() {
                    return Ok(false);
                }
                std::fs::write(p, bytes)?;
                Ok(true)
            }
            Armazenamento::Postgres(pool) => {
                let r = sqlx::query(
                    "insert into originais (sha256, nome_original, tipo_conteudo, conteudo) values ($1, $2, $3, $4)
                     on conflict (sha256) do nothing",
                )
                .bind(sha256)
                .bind(nome_original)
                .bind(tipo)
                .bind(bytes)
                .execute(pool)
                .await?;
                Ok(r.rows_affected() == 1)
            }
        }
    }

    pub async fn tem_original(&self, sha256: &str) -> Result<bool> {
        match self {
            Armazenamento::Pasta(dir) => Ok(std::fs::read_dir(dir.join("originais"))
                .map(|es| es.flatten().any(|e| e.path().file_stem().and_then(|s| s.to_str()) == Some(sha256)))
                .unwrap_or(false)),
            Armazenamento::Postgres(pool) => Ok(sqlx::query("select 1 from originais where sha256 = $1").bind(sha256).fetch_optional(pool).await?.is_some()),
        }
    }

    /// Documento original pelo SHA-256: (nome, tipo de conteúdo, bytes).
    pub async fn ler_original(&self, sha256: &str) -> Result<Option<(String, String, Vec<u8>)>> {
        if !sha256.chars().all(|c| c.is_ascii_hexdigit()) || sha256.len() != 64 {
            return Ok(None);
        }
        match self {
            Armazenamento::Pasta(dir) => {
                let pasta = dir.join("originais");
                let Ok(entradas) = std::fs::read_dir(&pasta) else { return Ok(None) };
                for e in entradas.flatten() {
                    let p = e.path();
                    if p.file_stem().and_then(|s| s.to_str()) == Some(sha256) {
                        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();
                        let tipo = tipo_por_extensao(&ext);
                        return Ok(Some((format!("{sha256}.{ext}"), tipo.into(), std::fs::read(&p)?)));
                    }
                }
                Ok(None)
            }
            Armazenamento::Postgres(pool) => {
                let linha = sqlx::query("select nome_original, coalesce(tipo_conteudo, ''), conteudo from originais where sha256 = $1")
                    .bind(sha256)
                    .fetch_optional(pool)
                    .await?;
                Ok(linha.map(|l| (l.get(0), l.get(1), l.get(2))))
            }
        }
    }
}

pub fn tipo_por_extensao(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "pdf" => "application/pdf",
        "csv" => "text/csv",
        "ofx" => "application/x-ofx",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

/// Cria a pasta de dados a partir dos modelos vazios, se ainda não existir.
fn preparar_pasta(dados: &Path) -> Result<()> {
    if dados.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(dados)?;
    let modelos = PathBuf::from("dados-exemplo");
    if modelos.is_dir() {
        for e in std::fs::read_dir(&modelos)? {
            let p = e?.path();
            if p.extension().is_some_and(|x| x == "json") {
                std::fs::copy(&p, dados.join(p.file_name().unwrap()))?;
            }
        }
        tracing::info!("pasta {} criada a partir de dados-exemplo/", dados.display());
    }
    Ok(())
}
