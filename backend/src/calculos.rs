//! Cálculos da Visão Geral. As definições estão em docs/MODELO_DE_DADOS.md
//! ("Indicadores do painel"). Um indicador sem dados vira `None`, nunca zero.

use chrono::{Datelike, NaiveDate};
use serde::Serialize;
use std::collections::BTreeMap;

use crate::modelo::*;

/// Competência no formato AAAA-MM.
pub fn competencia(ano: i32, mes: u32) -> String {
    format!("{ano:04}-{mes:02}")
}

/// Último dia do mês de uma competência AAAA-MM, como AAAA-MM-DD.
pub fn fim_do_mes(comp: &str) -> String {
    let (a, m) = comp.split_once('-').unwrap_or(("1970", "01"));
    let (a, m): (i32, u32) = (a.parse().unwrap_or(1970), m.parse().unwrap_or(1));
    let (na, nm) = if m == 12 { (a + 1, 1) } else { (a, m + 1) };
    let d = NaiveDate::from_ymd_opt(na, nm, 1).unwrap() - chrono::Duration::days(1);
    d.format("%Y-%m-%d").to_string()
}

fn comp_de(data: &str) -> &str {
    data.get(..7).unwrap_or(data)
}

/// Competência de uma movimentação: o ciclo da fatura, se houver, ou o mês da data.
fn comp_mov(m: &Movimentacao) -> &str {
    m.competencia.as_deref().unwrap_or_else(|| comp_de(&m.data))
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Fluxo {
    pub lancamentos: usize,
    pub receitas: f64,
    pub despesas_consumo: f64,
    pub pagamento_dividas: f64,
    pub aportes: f64,
    pub resgates: f64,
    pub sobra: f64,
    pub tem_estimativa: bool,
    /// Houve receita lançada em extrato no mês.
    pub tem_extrato_receita: bool,
    /// Sem extrato, a receita veio do líquido do holerite.
    pub receita_estimada_pelo_holerite: bool,
}

pub fn fluxo_do_mes(d: &Dados, comp: &str) -> Fluxo {
    let mut f = Fluxo::default();
    // Estorno é entrada (devolução de uma compra), não abate o gasto.
    let mut estornos = 0.0;
    for m in d.movimentacoes.movimentacoes.iter().filter(|m| comp_mov(m) == comp) {
        f.lancamentos += 1;
        if !m.status.confirmado() {
            f.tem_estimativa = true;
        }
        let v = m.valor;
        match m.natureza {
            Natureza::Receita => {
                f.receitas += v;
                f.tem_extrato_receita = true;
            }
            Natureza::Despesa => f.despesas_consumo += -v,
            Natureza::Estorno => estornos += v,
            Natureza::PagamentoDivida => f.pagamento_dividas += -v,
            Natureza::AporteInvestimento => f.aportes += -v,
            Natureza::ResgateInvestimento => f.resgates += v,
            Natureza::TransferenciaInterna | Natureza::Outra => {}
        }
    }
    // Sem extrato da conta no mês, usa o líquido do holerite como receita (estimativa).
    if f.lancamentos > 0 && !f.tem_extrato_receita {
        let s = salario_do_mes(d, comp);
        if s.holerites > 0 {
            f.receitas = s.liquido;
            f.receita_estimada_pelo_holerite = true;
        }
    }
    f.receitas += estornos;
    f.sobra = f.receitas - f.despesas_consumo - f.pagamento_dividas;
    f
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Salario {
    pub holerites: usize,
    pub bruto: f64,
    pub descontos: f64,
    pub liquido: f64,
    pub tem_estimativa: bool,
}

pub fn salario_do_mes(d: &Dados, comp: &str) -> Salario {
    let mut s = Salario::default();
    for h in d.holerites.holerites.iter().filter(|h| h.competencia == comp) {
        s.holerites += 1;
        s.bruto += h.bruto;
        s.descontos += h.total_descontos;
        s.liquido += h.liquido_competencia.unwrap_or(h.liquido);
        if !h.status.confirmado() {
            s.tem_estimativa = true;
        }
    }
    s
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct PosicaoInvestimentos {
    pub aplicacoes: usize,
    pub saldo: f64,
    /// Aportes menos resgates até a data.
    pub aportado: f64,
    pub rendimento: f64,
    pub tem_estimativa: bool,
    /// Aplicações com aportes mas sem posição informada até a data.
    pub sem_posicao: usize,
}

pub fn investimentos_ate(d: &Dados, limite: &str) -> PosicaoInvestimentos {
    let mut r = PosicaoInvestimentos::default();
    for i in &d.investimentos.investimentos {
        let aportado: f64 = i
            .movimentos
            .iter()
            .filter(|m| !m.data.is_empty() && m.data.as_str() <= limite)
            .map(|m| match m.tipo.as_str() {
                "aporte" => m.valor,
                "resgate" => -m.valor,
                _ => 0.0,
            })
            .sum();
        let posicao = i
            .posicoes
            .iter()
            .filter(|p| !p.data.is_empty() && p.data.as_str() <= limite)
            .max_by(|a, b| a.data.cmp(&b.data));
        match posicao {
            None => {
                if i.movimentos.iter().any(|m| m.data.as_str() <= limite) {
                    r.sem_posicao += 1;
                }
            }
            Some(p) => {
                r.aplicacoes += 1;
                r.saldo += p.saldo_bruto;
                r.aportado += aportado;
                if !p.status.confirmado() {
                    r.tem_estimativa = true;
                }
            }
        }
    }
    r.rendimento = r.saldo - r.aportado;
    r
}

#[derive(Debug, Clone, Serialize)]
pub struct DividaNaData {
    pub id: String,
    pub nome: String,
    pub saldo: f64,
    pub data: String,
    pub taxa_mensal: Option<f64>,
    pub estimado: bool,
}

pub fn dividas_ate(d: &Dados, limite: &str) -> Vec<DividaNaData> {
    let mut v: Vec<DividaNaData> = d
        .dividas
        .dividas
        .iter()
        .filter_map(|div| {
            let s = div
                .saldos
                .iter()
                .filter(|s| !s.data.is_empty() && s.data.as_str() <= limite)
                .max_by(|a, b| a.data.cmp(&b.data))?;
            if div.situacao.as_deref() == Some("quitada") && s.saldo_devedor == 0.0 {
                return None;
            }
            let nome = match (&div.nome, &div.tipo) {
                (Some(n), _) if !n.trim().is_empty() => n.clone(),
                (_, Some(t)) => format!("{} · {}", div.credor, t.replace('_', " ")),
                _ => div.credor.clone(),
            };
            Some(DividaNaData {
                id: div.id.clone(),
                nome,
                saldo: s.saldo_devedor,
                data: s.data.clone(),
                taxa_mensal: div.taxa_mensal,
                estimado: !s.status.confirmado(),
            })
        })
        .collect();
    v.sort_by(|a, b| b.saldo.total_cmp(&a.saldo));
    v
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct SaldoContas {
    pub contas: usize,
    pub total: f64,
    pub tem_estimativa: bool,
}

pub fn contas_ate(d: &Dados, comp: &str) -> SaldoContas {
    let mut ultimo: BTreeMap<&str, &SaldoConta> = BTreeMap::new();
    for s in d.movimentacoes.saldos.iter().filter(|s| !s.competencia.is_empty() && s.competencia.as_str() <= comp) {
        let e = ultimo.entry(s.conta_id.as_str()).or_insert(s);
        if s.competencia > e.competencia {
            *e = s;
        }
    }
    SaldoContas {
        contas: ultimo.len(),
        total: ultimo.values().map(|s| s.saldo_final).sum(),
        tem_estimativa: ultimo.values().any(|s| !s.status.confirmado()),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Patrimonio {
    pub valor: f64,
    pub contas: f64,
    pub investimentos: f64,
    pub dividas: f64,
    /// Componentes que ainda não têm dados.
    pub falta: Vec<String>,
    pub tem_estimativa: bool,
}

pub fn patrimonio(d: &Dados, comp: &str) -> Option<Patrimonio> {
    let lim = fim_do_mes(comp);
    let c = contas_ate(d, comp);
    let i = investimentos_ate(d, &lim);
    let dv = dividas_ate(d, &lim);
    if c.contas == 0 && i.aplicacoes == 0 && dv.is_empty() {
        return None;
    }
    let mut falta = vec![];
    if c.contas == 0 {
        falta.push("saldos de conta".into());
    }
    if i.aplicacoes == 0 && !d.investimentos.investimentos.is_empty() {
        falta.push("posição de investimentos".into());
    }
    let total_div: f64 = dv.iter().map(|x| x.saldo).sum();
    Some(Patrimonio {
        valor: c.total + i.saldo - total_div,
        contas: c.total,
        investimentos: i.saldo,
        dividas: total_div,
        falta,
        tem_estimativa: c.tem_estimativa || i.tem_estimativa || dv.iter().any(|x| x.estimado),
    })
}

// ---------- resposta da Visão Geral ----------

#[derive(Debug, Clone, Serialize)]
pub struct Periodo {
    pub ano: i32,
    pub mes: Option<u32>,
    pub competencias: Vec<String>,
    pub fim: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Indicadores {
    pub salario: Option<Salario>,
    pub fluxo: Option<Fluxo>,
    pub investimentos: Option<PosicaoInvestimentos>,
    pub dividas_total: Option<f64>,
    pub dividas_qtd: usize,
    pub dividas_estimado: bool,
    pub patrimonio: Option<Patrimonio>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PontoMensal {
    pub competencia: String,
    pub fluxo: Option<Fluxo>,
    pub patrimonio: Option<f64>,
    pub investimentos: Option<PosicaoInvestimentos>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Categoria {
    pub categoria: String,
    pub valor: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MetaProgresso {
    pub id: String,
    pub nome: String,
    pub valor_alvo: f64,
    pub saldo_reservado: f64,
    pub percentual: f64,
    pub prazo: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VisaoGeral {
    pub periodo: Periodo,
    pub indicadores: Indicadores,
    pub serie_mensal: Vec<PontoMensal>,
    /// Os 12 meses que terminam no fim do período (atravessa a virada do ano).
    pub ultimos_meses: Vec<PontoMensal>,
    pub despesas_por_categoria: Vec<Categoria>,
    pub dividas: Vec<DividaNaData>,
    pub metas: Vec<MetaProgresso>,
    pub anos_disponiveis: Vec<i32>,
    pub ultima_competencia_com_dados: Option<String>,
}

fn somar(a: &mut Fluxo, b: &Fluxo) {
    a.lancamentos += b.lancamentos;
    a.receitas += b.receitas;
    a.despesas_consumo += b.despesas_consumo;
    a.pagamento_dividas += b.pagamento_dividas;
    a.aportes += b.aportes;
    a.resgates += b.resgates;
    a.sobra += b.sobra;
    a.tem_estimativa |= b.tem_estimativa;
    a.tem_extrato_receita |= b.tem_extrato_receita;
    a.receita_estimada_pelo_holerite |= b.receita_estimada_pelo_holerite;
}

/// `mes = None` significa o ano inteiro. `hoje` limita a série mensal para
/// não repetir posições em meses que ainda não aconteceram.
pub fn visao_geral(d: &Dados, ano: i32, mes: Option<u32>, hoje: NaiveDate) -> VisaoGeral {
    let competencias: Vec<String> = match mes {
        Some(m) => vec![competencia(ano, m)],
        None => (1..=12).map(|m| competencia(ano, m)).collect(),
    };
    let ultima = competencias.last().cloned().unwrap();
    let fim = fim_do_mes(&ultima);

    // salário
    let mut sal = Salario::default();
    for c in &competencias {
        let s = salario_do_mes(d, c);
        sal.holerites += s.holerites;
        sal.bruto += s.bruto;
        sal.descontos += s.descontos;
        sal.liquido += s.liquido;
        sal.tem_estimativa |= s.tem_estimativa;
    }
    // fluxo
    let mut fl = Fluxo::default();
    for c in &competencias {
        somar(&mut fl, &fluxo_do_mes(d, c));
    }
    let inv = investimentos_ate(d, &fim);
    let dv = dividas_ate(d, &fim);

    let hoje_comp = competencia(hoje.year(), hoje.month());
    let serie_mensal = (1..=12)
        .map(|m| {
            let c = competencia(ano, m);
            let passado = c <= hoje_comp;
            let f = fluxo_do_mes(d, &c);
            let i = investimentos_ate(d, &fim_do_mes(&c));
            PontoMensal {
                fluxo: (f.lancamentos > 0).then_some(f),
                patrimonio: if passado { patrimonio(d, &c).map(|p| p.valor) } else { None },
                investimentos: (passado && i.aplicacoes > 0).then_some(i),
                competencia: c,
            }
        })
        .collect();

    let (mut a12, mut m12) = (ultima[..4].parse::<i32>().unwrap_or(ano), ultima[5..7].parse::<u32>().unwrap_or(12));
    let mut ultimos_meses = Vec::new();
    for _ in 0..12 {
        let c = competencia(a12, m12);
        if c <= hoje_comp {
            let f = fluxo_do_mes(d, &c);
            let i = investimentos_ate(d, &fim_do_mes(&c));
            ultimos_meses.push(PontoMensal {
                fluxo: (f.lancamentos > 0).then_some(f),
                patrimonio: patrimonio(d, &c).map(|p| p.valor),
                investimentos: (i.aplicacoes > 0).then_some(i),
                competencia: c,
            });
        }
        if m12 == 1 {
            a12 -= 1;
            m12 = 12;
        } else {
            m12 -= 1;
        }
    }
    ultimos_meses.reverse();

    let mut cats: BTreeMap<String, f64> = BTreeMap::new();
    for m in &d.movimentacoes.movimentacoes {
        if !competencias.iter().any(|c| c == comp_mov(m)) {
            continue;
        }
        if m.natureza == Natureza::Despesa {
            // Partes que não somam o valor (não deveria acontecer) contam como categoria inteira.
            let fecham = |p: &[Parte]| ((p.iter().map(|x| x.valor).sum::<f64>() - m.valor) * 100.0).round() == 0.0;
            match m.partes.as_deref().filter(|p| !p.is_empty() && fecham(p)) {
                // Dividido: cada parte conta no seu grupo.
                Some(partes) => {
                    for p in partes {
                        *cats.entry(p.categoria.clone()).or_default() += -p.valor;
                    }
                }
                None => {
                    let c = m.categoria.clone().unwrap_or_else(|| "sem categoria".into());
                    *cats.entry(c).or_default() += -m.valor;
                }
            }
        }
    }
    let mut despesas_por_categoria: Vec<Categoria> = cats
        .into_iter()
        .filter(|(_, v)| *v > 0.0)
        .map(|(categoria, valor)| Categoria { categoria, valor })
        .collect();
    despesas_por_categoria.sort_by(|a, b| b.valor.total_cmp(&a.valor));

    let metas = d
        .metas
        .metas
        .iter()
        .map(|m| MetaProgresso {
            id: m.id.clone(),
            nome: m.nome.clone(),
            valor_alvo: m.valor_alvo,
            saldo_reservado: m.saldo_reservado,
            percentual: if m.valor_alvo > 0.0 { m.saldo_reservado / m.valor_alvo * 100.0 } else { 0.0 },
            prazo: m.prazo.clone(),
        })
        .collect();

    VisaoGeral {
        indicadores: Indicadores {
            salario: (sal.holerites > 0).then_some(sal),
            fluxo: (fl.lancamentos > 0).then_some(fl),
            investimentos: (inv.aplicacoes > 0 || inv.sem_posicao > 0).then_some(inv),
            dividas_total: (!dv.is_empty()).then(|| dv.iter().map(|x| x.saldo).sum()),
            dividas_qtd: dv.len(),
            dividas_estimado: dv.iter().any(|x| x.estimado),
            patrimonio: patrimonio(d, &ultima),
        },
        periodo: Periodo { ano, mes, competencias, fim },
        serie_mensal,
        ultimos_meses,
        despesas_por_categoria,
        dividas: dv,
        metas,
        anos_disponiveis: anos_disponiveis(d, hoje.year()),
        ultima_competencia_com_dados: ultima_competencia(d),
    }
}

fn anos_disponiveis(d: &Dados, ano_atual: i32) -> Vec<i32> {
    let mut anos = vec![ano_atual];
    let mut add = |s: &str| {
        if let Some(a) = s.get(..4).and_then(|x| x.parse::<i32>().ok()) {
            if (1990..2100).contains(&a) {
                anos.push(a);
            }
        }
    };
    d.holerites.holerites.iter().for_each(|h| add(&h.competencia));
    d.movimentacoes.movimentacoes.iter().for_each(|m| add(&m.data));
    d.investimentos.investimentos.iter().flat_map(|i| &i.posicoes).for_each(|p| add(&p.data));
    d.dividas.dividas.iter().flat_map(|x| &x.saldos).for_each(|s| add(&s.data));
    anos.sort_unstable_by(|a, b| b.cmp(a));
    anos.dedup();
    anos
}

fn ultima_competencia(d: &Dados) -> Option<String> {
    d.holerites
        .holerites
        .iter()
        .map(|h| h.competencia.clone())
        .chain(d.movimentacoes.movimentacoes.iter().map(|m| comp_mov(m).to_string()))
        .max()
}

#[cfg(test)]
mod testes {
    use super::*;

    fn dados() -> Dados {
        // Dados de teste: não são dados do usuário.
        let mut d = Dados::default();
        d.holerites.holerites.push(Holerite {
            competencia: "2026-06".into(),
            bruto: 1000.0,
            total_descontos: 100.0,
            liquido: 900.0,
            status: Status::Confirmado,
            ..Default::default()
        });
        let mv = |data: &str, valor: f64, natureza: Natureza, cat: Option<&str>| Movimentacao {
            id: String::new(),
            conta_id: Some("c1".into()),
            data: data.into(),
            descricao: String::new(),
            valor,
            natureza,
            categoria: cat.map(String::from),
            recorrencia: None,
            competencia: None,
            status: Status::Confirmado,
            partes: None,
        };
        d.movimentacoes.movimentacoes = vec![
            mv("2026-06-05", 900.0, Natureza::Receita, None),
            mv("2026-06-10", -300.0, Natureza::Despesa, Some("moradia")),
            mv("2026-06-11", -100.0, Natureza::Despesa, Some("alimentacao")),
            mv("2026-06-12", 20.0, Natureza::Estorno, Some("alimentacao")),
            mv("2026-06-15", -200.0, Natureza::PagamentoDivida, None),
            mv("2026-06-16", -150.0, Natureza::AporteInvestimento, None),
            mv("2026-06-17", -50.0, Natureza::TransferenciaInterna, None),
        ];
        d.movimentacoes.saldos.push(SaldoConta {
            conta_id: "c1".into(),
            competencia: "2026-06".into(),
            saldo_final: 500.0,
            status: Status::Confirmado,
            ..Default::default()
        });
        d.investimentos.investimentos.push(Investimento {
            nome: "CDB".into(),
            movimentos: vec![MovimentoInvestimento { data: "2026-01-10".into(), tipo: "aporte".into(), valor: 1000.0 }],
            posicoes: vec![Posicao { data: "2026-06-30".into(), saldo_bruto: 1060.0, saldo_liquido: None, status: Status::Estimado }],
            ..Default::default()
        });
        d.dividas.dividas.push(Divida {
            credor: "Banco".into(),
            saldos: vec![SaldoDivida { data: "2026-06-01".into(), saldo_devedor: 800.0, status: Status::Confirmado }],
            ..Default::default()
        });
        d
    }

    #[test]
    fn fim_do_mes_considera_ano_bissexto_e_dezembro() {
        assert_eq!(fim_do_mes("2028-02"), "2028-02-29");
        assert_eq!(fim_do_mes("2026-12"), "2026-12-31");
    }

    #[test]
    fn sobra_exclui_aportes_e_transferencias() {
        let f = fluxo_do_mes(&dados(), "2026-06");
        assert_eq!(f.receitas, 920.0); // 900 + 20 de estorno (estorno é entrada)
        assert_eq!(f.despesas_consumo, 400.0); // 300 + 100
        assert_eq!(f.pagamento_dividas, 200.0);
        assert_eq!(f.aportes, 150.0);
        assert_eq!(f.sobra, 320.0);
    }

    #[test]
    fn patrimonio_soma_contas_e_investimentos_menos_dividas() {
        let p = patrimonio(&dados(), "2026-06").unwrap();
        assert_eq!(p.valor, 500.0 + 1060.0 - 800.0);
        assert!(p.tem_estimativa);
        assert!(p.falta.is_empty());
    }

    #[test]
    fn investimento_separa_aportado_de_rendimento() {
        let i = investimentos_ate(&dados(), "2026-06-30");
        assert_eq!(i.aportado, 1000.0);
        assert!((i.rendimento - 60.0).abs() < 1e-9);
    }

    #[test]
    fn cartao_usa_ciclo_e_receita_do_holerite() {
        let mut d = dados();
        d.movimentacoes.movimentacoes.retain(|m| m.natureza != Natureza::Receita);
        d.holerites.holerites[0].liquido_competencia = Some(1500.0);
        // compra de 30/05 lançada no ciclo de junho
        let mut m = d.movimentacoes.movimentacoes[1].clone();
        m.data = "2026-05-30".into();
        m.competencia = Some("2026-06".into());
        d.movimentacoes.movimentacoes.push(m);
        let f = fluxo_do_mes(&d, "2026-06");
        assert!(f.receita_estimada_pelo_holerite);
        assert!(!f.tem_extrato_receita, "estorno não é receita de extrato");
        assert_eq!(f.receitas, 1520.0); // líquido do holerite + 20 de estorno
        assert_eq!(f.despesas_consumo, 500.0); // 400 do mês + 100 da compra de maio no ciclo de junho
        assert_eq!(fluxo_do_mes(&d, "2026-05").lancamentos, 0);
    }

    #[test]
    fn sem_dados_nao_vira_zero() {
        let v = visao_geral(&Dados::default(), 2026, Some(6), NaiveDate::from_ymd_opt(2026, 10, 14).unwrap());
        assert!(v.indicadores.salario.is_none());
        assert!(v.indicadores.fluxo.is_none());
        assert!(v.indicadores.patrimonio.is_none());
        assert!(v.indicadores.dividas_total.is_none());
    }

    #[test]
    fn serie_nao_projeta_meses_futuros() {
        let v = visao_geral(&dados(), 2026, None, NaiveDate::from_ymd_opt(2026, 10, 14).unwrap());
        assert!(v.serie_mensal[9].patrimonio.is_some()); // outubro
        assert!(v.serie_mensal[10].patrimonio.is_none()); // novembro
        assert_eq!(v.despesas_por_categoria[0].categoria, "moradia");
    }

    #[test]
    fn estorno_nao_abate_gasto_da_categoria() {
        let v = visao_geral(&dados(), 2026, Some(6), NaiveDate::from_ymd_opt(2026, 10, 14).unwrap());
        let alim = v.despesas_por_categoria.iter().find(|c| c.categoria == "alimentacao").unwrap();
        assert_eq!(alim.valor, 100.0);
        let total: f64 = v.despesas_por_categoria.iter().map(|c| c.valor).sum();
        assert_eq!(total, v.indicadores.fluxo.unwrap().despesas_consumo);
    }

    #[test]
    fn gasto_por_categoria_soma_por_parte() {
        let mut d = dados();
        // Compra de 250 dividida: 200 de moradia e 50 de alimentação.
        let mut m = d.movimentacoes.movimentacoes[1].clone();
        m.valor = -250.0;
        m.categoria = Some("moradia".into());
        m.partes = Some(vec![
            Parte { valor: -200.0, categoria: "moradia".into(), subcategoria: None },
            Parte { valor: -50.0, categoria: "alimentacao".into(), subcategoria: Some("Padaria".into()) },
        ]);
        d.movimentacoes.movimentacoes.push(m);
        let v = visao_geral(&d, 2026, Some(6), NaiveDate::from_ymd_opt(2026, 10, 14).unwrap());
        let valor = |c: &str| v.despesas_por_categoria.iter().find(|x| x.categoria == c).unwrap().valor;
        assert_eq!(valor("moradia"), 500.0);
        assert_eq!(valor("alimentacao"), 150.0);
        let total: f64 = v.despesas_por_categoria.iter().map(|c| c.valor).sum();
        assert_eq!(total, v.indicadores.fluxo.unwrap().despesas_consumo, "dividir não muda o total");
    }

    #[test]
    fn partes_que_nao_fecham_contam_a_categoria_inteira() {
        let mut d = dados();
        let mut m = d.movimentacoes.movimentacoes[1].clone();
        m.valor = -250.0;
        m.categoria = Some("moradia".into());
        m.partes = Some(vec![
            Parte { valor: -200.0, categoria: "moradia".into(), subcategoria: None },
            Parte { valor: -49.0, categoria: "alimentacao".into(), subcategoria: None },
        ]);
        d.movimentacoes.movimentacoes.push(m);
        let v = visao_geral(&d, 2026, Some(6), NaiveDate::from_ymd_opt(2026, 10, 14).unwrap());
        let valor = |c: &str| v.despesas_por_categoria.iter().find(|x| x.categoria == c).unwrap().valor;
        assert_eq!(valor("moradia"), 550.0);
        assert_eq!(valor("alimentacao"), 100.0);
    }
}
