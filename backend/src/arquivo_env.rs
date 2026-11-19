//! Lê o `.env` da raiz do repositório na partida, para cada pessoa configurar a própria cópia
//! sem exportar variáveis à mão. O que já está no ambiente (Render, `env -i`, terminal) sempre vence:
//! o arquivo só preenche o que falta. Sem `.env`, nada muda.

use std::path::Path;

/// Pares `CHAVE=valor` de um `.env`: ignora linhas vazias e comentários (`#`), aceita `export CHAVE=…`
/// e tira aspas simples ou duplas em volta do valor. Linhas sem `=` ou com chave inválida são ignoradas.
pub fn ler(texto: &str) -> Vec<(String, String)> {
    let mut l = Vec::new();
    for linha in texto.lines() {
        let linha = linha.trim();
        if linha.is_empty() || linha.starts_with('#') {
            continue;
        }
        let linha = linha.strip_prefix("export ").unwrap_or(linha);
        let Some((chave, valor)) = linha.split_once('=') else { continue };
        let chave = chave.trim();
        if chave.is_empty() || !chave.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            continue;
        }
        let valor = valor.trim();
        let valor = ['"', '\'']
            .iter()
            .find_map(|q| valor.strip_prefix(*q).and_then(|v| v.strip_suffix(*q)))
            .unwrap_or(valor);
        l.push((chave.to_string(), valor.to_string()));
    }
    l
}

/// Carrega `caminho` no ambiente, sem sobrescrever o que já existe nem gravar valores vazios.
/// Devolve quantas variáveis foram preenchidas.
pub fn carregar(caminho: &Path) -> usize {
    let Ok(texto) = std::fs::read_to_string(caminho) else { return 0 };
    let mut n = 0;
    for (chave, valor) in ler(&texto) {
        if valor.is_empty() || std::env::var_os(&chave).is_some() {
            continue;
        }
        std::env::set_var(&chave, &valor);
        n += 1;
    }
    n
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn le_pares_comentarios_e_aspas() {
        let t = "##PLUGGY\n# comentário\n\nPLUGGY_CLIENT_ID=abc\nexport X_Y = \"com espaço\" \nZ='1,2'\nVAZIA=\nsem igual\nmá-chave=1\n";
        assert_eq!(
            ler(t),
            vec![
                ("PLUGGY_CLIENT_ID".into(), "abc".into()),
                ("X_Y".into(), "com espaço".into()),
                ("Z".into(), "1,2".into()),
                ("VAZIA".into(), String::new()),
            ]
        );
    }

    #[test]
    fn valor_com_igual_fica_inteiro() {
        assert_eq!(ler("DATABASE_URL=postgres://u:p@h/db?sslmode=require"), vec![("DATABASE_URL".into(), "postgres://u:p@h/db?sslmode=require".into())]);
    }

    #[test]
    fn ambiente_vence_o_arquivo_e_vazio_nao_grava() {
        let dir = std::env::temp_dir().join(format!("env-teste-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let arq = dir.join(".env");
        std::fs::write(&arq, "ARQ_ENV_TESTE_A=do-arquivo\nARQ_ENV_TESTE_B=novo\nARQ_ENV_TESTE_C=\n").unwrap();
        std::env::set_var("ARQ_ENV_TESTE_A", "do-ambiente");
        assert_eq!(carregar(&arq), 1);
        assert_eq!(std::env::var("ARQ_ENV_TESTE_A").unwrap(), "do-ambiente");
        assert_eq!(std::env::var("ARQ_ENV_TESTE_B").unwrap(), "novo");
        assert!(std::env::var_os("ARQ_ENV_TESTE_C").is_none());
        assert_eq!(carregar(&dir.join("nao-existe")), 0);
        std::fs::remove_dir_all(&dir).ok();
    }
}
