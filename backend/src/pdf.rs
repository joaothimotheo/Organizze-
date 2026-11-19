//! Extração de texto de PDF com posição de cada palavra.
//!
//! Faturas têm duas colunas lado a lado; ler o texto "corrido" mistura as duas.
//! Por isso guardamos x/y de cada letra e montamos palavras e linhas por posição.

use anyhow::{anyhow, Result};
use pdf_extract::{MediaBox, OutputDev, OutputError, Transform};

#[derive(Debug, Clone)]
pub struct Palavra {
    pub x0: f64,
    pub x1: f64,
    /// Distância a partir do topo da página.
    pub y: f64,
    pub texto: String,
}

#[derive(Debug, Clone, Default)]
pub struct Pagina {
    pub largura: f64,
    pub altura: f64,
    pub palavras: Vec<Palavra>,
}

impl Pagina {
    /// Texto da página inteira, uma linha por linha visual.
    pub fn texto(&self) -> String {
        linhas(self.palavras.iter().collect()).iter().map(|l| juntar(l)).collect::<Vec<_>>().join("\n")
    }
}

struct Letra {
    x: f64,
    y: f64,
    largura: f64,
    tamanho: f64,
    c: String,
}

#[derive(Default)]
struct Coletor {
    paginas: Vec<(f64, f64, Vec<Letra>)>,
}

impl OutputDev for Coletor {
    fn begin_page(&mut self, _n: u32, mb: &MediaBox, _art: Option<(f64, f64, f64, f64)>) -> Result<(), OutputError> {
        self.paginas.push((mb.urx - mb.llx, mb.ury - mb.lly, Vec::new()));
        Ok(())
    }
    fn end_page(&mut self) -> Result<(), OutputError> {
        Ok(())
    }
    fn output_character(&mut self, trm: &Transform, width: f64, _spacing: f64, font_size: f64, c: &str) -> Result<(), OutputError> {
        if let Some(p) = self.paginas.last_mut() {
            let altura = p.1;
            p.2.push(Letra {
                x: trm.m31,
                y: altura - trm.m32,
                largura: width * font_size * trm.m11.abs(),
                tamanho: (font_size * trm.m22.abs()).max(1.0),
                c: c.to_string(),
            });
        }
        Ok(())
    }
    fn begin_word(&mut self) -> Result<(), OutputError> {
        Ok(())
    }
    fn end_word(&mut self) -> Result<(), OutputError> {
        Ok(())
    }
    fn end_line(&mut self) -> Result<(), OutputError> {
        Ok(())
    }
}

/// Lê o PDF e devolve as palavras de cada página.
pub fn extrair(bytes: &[u8]) -> Result<Vec<Pagina>> {
    let bytes = bytes.to_vec();
    // A biblioteca pode entrar em pânico com PDFs malformados; isolamos isso.
    let r = std::panic::catch_unwind(move || -> Result<Vec<Pagina>> {
        let doc = pdf_extract::Document::load_mem(&bytes).map_err(|e| anyhow!("PDF ilegível: {e}"))?;
        let mut c = Coletor::default();
        let r = pdf_extract::output_doc(&doc, &mut c);
        if c.paginas.iter().all(|p| p.2.is_empty()) {
            if doc.is_encrypted() {
                return Err(anyhow!("o PDF está protegido por senha; baixe a versão sem senha no app do banco"));
            }
            r.map_err(|e| anyhow!("não consegui ler o texto do PDF: {e}"))?;
            return Err(anyhow!("o PDF não tem texto (parece uma imagem escaneada); envie o PDF original do app ou site"));
        }
        Ok(c.paginas.into_iter().map(|(l, a, letras)| Pagina { largura: l, altura: a, palavras: palavras(letras) }).collect())
    });
    r.unwrap_or_else(|_| Err(anyhow!("não consegui ler o texto do PDF")))
}

/// Junta letras próximas na mesma linha em palavras.
fn palavras(mut letras: Vec<Letra>) -> Vec<Palavra> {
    // Agrupa por linha (y próximo) mantendo a ordem horizontal.
    letras.sort_by(|a, b| a.y.total_cmp(&b.y).then(a.x.total_cmp(&b.x)));
    let mut grupos: Vec<Vec<Letra>> = Vec::new();
    for l in letras {
        match grupos.last_mut() {
            Some(g) if (l.y - g[0].y).abs() <= g[0].tamanho.min(l.tamanho) * 0.4 => g.push(l),
            _ => grupos.push(vec![l]),
        }
    }
    let mut out = Vec::new();
    for mut g in grupos {
        g.sort_by(|a, b| a.x.total_cmp(&b.x));
        let mut atual: Option<Palavra> = None;
        for l in g {
            // Qualquer espaço (inclusive o não separável, comum entre "R$" e o valor) separa palavras.
            let espaco = l.c.trim().is_empty();
            let distante = atual.as_ref().is_some_and(|p| l.x - p.x1 > l.tamanho * 0.25);
            if espaco || distante {
                if let Some(p) = atual.take() {
                    out.push(p);
                }
                if espaco {
                    continue;
                }
            }
            match atual.as_mut() {
                Some(p) => {
                    p.texto.push_str(&l.c);
                    p.x1 = p.x1.max(l.x + l.largura);
                }
                None => atual = Some(Palavra { x0: l.x, x1: l.x + l.largura, y: l.y, texto: l.c.clone() }),
            }
        }
        if let Some(p) = atual {
            out.push(p);
        }
    }
    out
}

/// Agrupa palavras em linhas visuais (de cima para baixo, da esquerda para a direita).
pub fn linhas(mut ps: Vec<&Palavra>) -> Vec<Vec<&Palavra>> {
    ps.sort_by(|a, b| a.y.total_cmp(&b.y).then(a.x0.total_cmp(&b.x0)));
    let mut out: Vec<Vec<&Palavra>> = Vec::new();
    for p in ps {
        match out.last_mut() {
            Some(l) if (p.y - l[0].y).abs() <= 2.5 => l.push(p),
            _ => out.push(vec![p]),
        }
    }
    for l in &mut out {
        l.sort_by(|a, b| a.x0.total_cmp(&b.x0));
    }
    out
}

pub fn juntar(l: &[&Palavra]) -> String {
    l.iter().map(|p| p.texto.as_str()).collect::<Vec<_>>().join(" ")
}

/// "1.234,56" ou "-1.234,56" → 1234.56
pub fn valor_br(s: &str) -> Option<f64> {
    let s = s.trim().trim_start_matches("R$").trim();
    let (neg, s) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s),
    };
    let (int, dec) = s.split_once(',')?;
    if dec.len() != 2 || !dec.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let partes: Vec<&str> = int.split('.').collect();
    if partes.is_empty() || partes[0].is_empty() || partes[0].len() > 3 || !partes.iter().all(|p| p.chars().all(|c| c.is_ascii_digit())) {
        return None;
    }
    if partes.iter().skip(1).any(|p| p.len() != 3) {
        return None;
    }
    let v: f64 = format!("{}.{}", partes.concat(), dec).parse().ok()?;
    Some(if neg { -v } else { v })
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn le_valores_brasileiros() {
        assert_eq!(valor_br("1.890,73"), Some(1890.73));
        assert_eq!(valor_br("-3.670,86"), Some(-3670.86));
        assert_eq!(valor_br("R$ 53,33"), Some(53.33));
        assert_eq!(valor_br("14,99"), Some(14.99));
        assert_eq!(valor_br("04/09"), None);
        assert_eq!(valor_br("1.89,73"), None);
        assert_eq!(valor_br("12,5"), None);
    }
}
