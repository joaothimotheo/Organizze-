//! Tipos dos arquivos JSON em `dados/` (schema v1, ver docs/MODELO_DE_DADOS.md).
//! Todos os campos são tolerantes: o que faltar vira `None` ou lista vazia.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Confirmado,
    Estimado,
    #[default]
    Pendente,
}

impl Status {
    pub fn confirmado(self) -> bool {
        self == Status::Confirmado
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Origem {
    pub documento_id: Option<String>,
    pub pagina: Option<u32>,
    pub linha: Option<u32>,
}

// ---------- config.json ----------
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub titular: Option<String>,
    pub moeda: Option<String>,
    pub contas: Vec<Conta>,
    pub atualizado_em: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Conta {
    pub id: String,
    pub instituicao: Option<String>,
    pub tipo: Option<String>,
    pub apelido: Option<String>,
    /// Últimos dígitos da conta (nunca o número completo).
    #[serde(rename = "final")]
    pub final_conta: Option<String>,
}

// ---------- holerites.json ----------
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ArquivoHolerites {
    pub holerites: Vec<Holerite>,
    pub atualizado_em: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Holerite {
    pub id: String,
    pub competencia: String,
    pub empregador: Option<String>,
    pub data_pagamento: Option<String>,
    pub tipo: Option<String>,
    pub proventos: Vec<Lancamento>,
    pub descontos: Vec<Lancamento>,
    pub bruto: f64,
    pub total_descontos: f64,
    pub liquido: f64,
    /// Líquido somado a adiantamentos já recebidos (ex.: férias pagas antes). Ausente = `liquido`.
    pub liquido_competencia: Option<f64>,
    pub fgts: Option<f64>,
    pub origem: Origem,
    pub status: Status,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Lancamento {
    pub codigo: Option<String>,
    pub descricao: String,
    pub referencia: Option<String>,
    pub valor: f64,
    pub tipo: Option<String>,
    pub natureza: Option<String>,
    pub recorrente: Option<bool>,
}

// ---------- movimentacoes.json ----------
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ArquivoMovimentacoes {
    pub movimentacoes: Vec<Movimentacao>,
    pub saldos: Vec<SaldoConta>,
    pub atualizado_em: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Natureza {
    Receita,
    Despesa,
    TransferenciaInterna,
    AporteInvestimento,
    ResgateInvestimento,
    PagamentoDivida,
    Estorno,
    #[serde(other)]
    Outra,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Movimentacao {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub conta_id: Option<String>,
    pub data: String,
    #[serde(default)]
    pub descricao: String,
    /// Entradas positivas, saídas negativas.
    pub valor: f64,
    pub natureza: Natureza,
    #[serde(default)]
    pub categoria: Option<String>,
    #[serde(default)]
    pub recorrencia: Option<String>,
    /// Mês a que a movimentação pertence (no cartão, o ciclo da fatura). Ausente = mês de `data`.
    #[serde(default)]
    pub competencia: Option<String>,
    #[serde(default)]
    pub status: Status,
    /// Divisão do lançamento entre grupos (2 a 10 partes que somam o valor). Ausente = uma só.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partes: Option<Vec<Parte>>,
}

/// Um pedaço de um lançamento dividido: valor com o mesmo sinal do lançamento.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Parte {
    pub valor: f64,
    pub categoria: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subcategoria: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SaldoConta {
    pub conta_id: String,
    pub competencia: String,
    pub saldo_inicial: Option<f64>,
    pub saldo_final: f64,
    pub status: Status,
}

// ---------- dividas.json ----------
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ArquivoDividas {
    pub dividas: Vec<Divida>,
    pub atualizado_em: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Divida {
    pub id: String,
    /// Nome dado por você (ex.: "IPVA 2025"). Ausente = credor + tipo.
    pub nome: Option<String>,
    pub credor: String,
    pub tipo: Option<String>,
    pub valor_contratado: Option<f64>,
    pub taxa_mensal: Option<f64>,
    pub taxa_anual: Option<f64>,
    pub cet_anual: Option<f64>,
    pub sistema: Option<String>,
    pub parcelas_total: Option<u32>,
    pub parcela_valor: Option<f64>,
    pub saldos: Vec<SaldoDivida>,
    pub situacao: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SaldoDivida {
    pub data: String,
    pub saldo_devedor: f64,
    pub status: Status,
}

// ---------- investimentos.json ----------
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ArquivoInvestimentos {
    pub investimentos: Vec<Investimento>,
    pub atualizado_em: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Investimento {
    pub id: String,
    pub instituicao: Option<String>,
    pub nome: String,
    pub tipo: Option<String>,
    pub indexador: Option<String>,
    pub percentual_indexador: Option<f64>,
    pub movimentos: Vec<MovimentoInvestimento>,
    pub posicoes: Vec<Posicao>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct MovimentoInvestimento {
    pub data: String,
    /// aporte | resgate | ir | iof | taxa
    pub tipo: String,
    pub valor: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Posicao {
    pub data: String,
    pub saldo_bruto: f64,
    pub saldo_liquido: Option<f64>,
    pub status: Status,
}

// ---------- metas.json ----------
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ArquivoMetas {
    pub metas: Vec<Meta>,
    pub atualizado_em: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Meta {
    pub id: String,
    pub nome: String,
    pub valor_alvo: f64,
    pub prazo: Option<String>,
    pub saldo_reservado: f64,
    pub prioridade: Option<u32>,
    pub aporte_mensal_planejado: Option<f64>,
}

/// Todos os arquivos carregados de uma vez.
/// `config`, `indicadores` e `documentos` ainda não entram nos cálculos (próximas etapas).
#[allow(dead_code)]
#[derive(Debug, Clone, Default)]
pub struct Dados {
    pub config: Config,
    pub holerites: ArquivoHolerites,
    pub movimentacoes: ArquivoMovimentacoes,
    pub dividas: ArquivoDividas,
    pub investimentos: ArquivoInvestimentos,
    pub metas: ArquivoMetas,
    /// Mantido como JSON livre para preservar campos desconhecidos ao regravar.
    pub indicadores: serde_json::Value,
    pub documentos: serde_json::Value,
}
