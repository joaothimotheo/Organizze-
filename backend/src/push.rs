//! Web Push próprio: cifra aes128gcm (RFC 8291), VAPID (RFC 8292) e envio.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes128Gcm, Nonce};
use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hkdf::Hkdf;
use p256::ecdh::diffie_hellman;
use p256::ecdsa::signature::Signer;
use p256::ecdsa::{Signature, SigningKey};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::{PublicKey, SecretKey};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::Sha256;

const TAMANHO_REGISTRO: u32 = 4096;

/// Par de chaves VAPID em base64url sem padding.
#[derive(Clone)]
pub struct Chaves {
    pub publica: String,
    pub privada: String,
}

/// Resultado de uma tentativa de entrega.
#[derive(Debug, PartialEq)]
pub enum Entrega {
    Entregue,
    Expirado,
    Falhou(String),
}

fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn de_b64(texto: &str) -> Result<Vec<u8>> {
    Ok(URL_SAFE_NO_PAD.decode(texto.trim_end_matches('='))?)
}

fn ponto_publico(chave: &PublicKey) -> Vec<u8> {
    chave.to_encoded_point(false).as_bytes().to_vec()
}

pub fn gerar_chaves() -> Chaves {
    let privada = SecretKey::random(&mut OsRng);
    Chaves {
        publica: b64(&ponto_publico(&privada.public_key())),
        privada: b64(privada.to_bytes().as_slice()),
    }
}

/// Monta o corpo `aes128gcm` completo (cabeçalho + registro único).
/// `efemera` serve apenas para testes com valores fixos.
pub fn cifrar(
    p256dh: &str,
    auth: &str,
    mensagem: &[u8],
    sal: [u8; 16],
    efemera: Option<&SecretKey>,
) -> Result<Vec<u8>> {
    let ua_publica_bytes = de_b64(p256dh).context("p256dh inválida")?;
    let ua_publica = PublicKey::from_sec1_bytes(&ua_publica_bytes).map_err(|_| anyhow!("p256dh inválida"))?;
    let segredo_auth = de_b64(auth).context("auth inválido")?;

    let gerada;
    let efemera = match efemera {
        Some(e) => e,
        None => {
            gerada = SecretKey::random(&mut OsRng);
            &gerada
        }
    };
    let as_publica = ponto_publico(&efemera.public_key());
    let compartilhado = diffie_hellman(efemera.to_nonzero_scalar(), ua_publica.as_affine());

    // RFC 8291 §3.4: chave de entrada
    let mut info_chave = b"WebPush: info\0".to_vec();
    info_chave.extend_from_slice(&ua_publica_bytes);
    info_chave.extend_from_slice(&as_publica);
    let mut ikm = [0u8; 32];
    Hkdf::<Sha256>::new(Some(&segredo_auth), compartilhado.raw_secret_bytes().as_slice())
        .expand(&info_chave, &mut ikm)
        .map_err(|_| anyhow!("falha no HKDF"))?;

    // RFC 8188: chave de conteúdo e nonce
    let prk = Hkdf::<Sha256>::new(Some(&sal), &ikm);
    let mut cek = [0u8; 16];
    prk.expand(b"Content-Encoding: aes128gcm\0", &mut cek)
        .map_err(|_| anyhow!("falha no HKDF"))?;
    let mut nonce = [0u8; 12];
    prk.expand(b"Content-Encoding: nonce\0", &mut nonce)
        .map_err(|_| anyhow!("falha no HKDF"))?;

    let mut registro = mensagem.to_vec();
    registro.push(0x02);
    if registro.len() + 16 > TAMANHO_REGISTRO as usize {
        return Err(anyhow!("mensagem grande demais"));
    }
    let cifrado = Aes128Gcm::new_from_slice(&cek)
        .map_err(|_| anyhow!("chave inválida"))?
        .encrypt(Nonce::from_slice(&nonce), registro.as_slice())
        .map_err(|_| anyhow!("falha ao cifrar"))?;

    let mut corpo = Vec::with_capacity(21 + as_publica.len() + cifrado.len());
    corpo.extend_from_slice(&sal);
    corpo.extend_from_slice(&TAMANHO_REGISTRO.to_be_bytes());
    corpo.push(as_publica.len() as u8);
    corpo.extend_from_slice(&as_publica);
    corpo.extend_from_slice(&cifrado);
    Ok(corpo)
}

/// JWT VAPID (ES256) para o serviço de push do `endpoint`.
pub fn jwt_vapid(chaves: &Chaves, endpoint: &str, assunto: &str, agora_unix: i64) -> Result<String> {
    let url = reqwest::Url::parse(endpoint).context("endpoint inválido")?;
    let origem = url.origin().ascii_serialization();
    let cabecalho = b64(br#"{"typ":"JWT","alg":"ES256"}"#);
    let corpo = b64(
        serde_json::json!({ "aud": origem, "exp": agora_unix + 12 * 3600, "sub": assunto })
            .to_string()
            .as_bytes(),
    );
    let a_assinar = format!("{cabecalho}.{corpo}");
    let chave = SigningKey::from_slice(&de_b64(&chaves.privada)?).map_err(|_| anyhow!("chave VAPID inválida"))?;
    let assinatura: Signature = chave.sign(a_assinar.as_bytes());
    Ok(format!("{a_assinar}.{}", b64(assinatura.to_bytes().as_slice())))
}

/// Cifra e envia uma notificação. Não registra endpoint nem conteúdo.
pub async fn enviar(
    http: &reqwest::Client,
    chaves: &Chaves,
    assunto: &str,
    endpoint: &str,
    p256dh: &str,
    auth: &str,
    json: &serde_json::Value,
) -> Entrega {
    let mut sal = [0u8; 16];
    OsRng.fill_bytes(&mut sal);
    let corpo = match cifrar(p256dh, auth, json.to_string().as_bytes(), sal, None) {
        Ok(c) => c,
        Err(e) => return Entrega::Falhou(format!("cifra: {e}")),
    };
    let agora = chrono::Utc::now().timestamp();
    let jwt = match jwt_vapid(chaves, endpoint, assunto, agora) {
        Ok(j) => j,
        Err(e) => return Entrega::Falhou(format!("vapid: {e}")),
    };
    let resposta = http
        .post(endpoint)
        .header("Content-Encoding", "aes128gcm")
        .header("Content-Type", "application/octet-stream")
        .header("TTL", "86400")
        .header("Urgency", "normal")
        .header("Authorization", format!("vapid t={jwt}, k={}", chaves.publica))
        .body(corpo)
        .send()
        .await;
    match resposta {
        Ok(r) => match r.status().as_u16() {
            200 | 201 | 202 => Entrega::Entregue,
            404 | 410 => Entrega::Expirado,
            codigo => Entrega::Falhou(format!("status {codigo}")),
        },
        Err(e) => Entrega::Falhou(format!("rede: {}", e.without_url())),
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use p256::ecdsa::signature::Verifier;
    use p256::ecdsa::VerifyingKey;

    #[test]
    fn cifra_bate_com_rfc8291() {
        let efemera = SecretKey::from_slice(&de_b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw").unwrap()).unwrap();
        let sal: [u8; 16] = de_b64("DGv6ra1nlYgDCS1FRnbzlw").unwrap().try_into().unwrap();
        let corpo = cifrar(
            "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
            "BTBZMqHH6r4Tts7J_aSIgg",
            b"When I grow up, I want to be a watermelon",
            sal,
            Some(&efemera),
        )
        .unwrap();
        assert_eq!(
            b64(&corpo),
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
        );
    }

    #[test]
    fn jwt_vapid_verifica() {
        let chaves = gerar_chaves();
        let jwt = jwt_vapid(&chaves, "https://fcm.googleapis.com/fcm/send/abc", "mailto:a@b.com", 1_000).unwrap();
        let partes: Vec<&str> = jwt.split('.').collect();
        assert_eq!(partes.len(), 3);
        assert_eq!(de_b64(partes[0]).unwrap(), br#"{"typ":"JWT","alg":"ES256"}"#);
        let corpo: serde_json::Value = serde_json::from_slice(&de_b64(partes[1]).unwrap()).unwrap();
        assert_eq!(corpo["aud"], "https://fcm.googleapis.com");
        assert_eq!(corpo["exp"], 1_000 + 43_200);
        assert_eq!(corpo["sub"], "mailto:a@b.com");
        let verificador = VerifyingKey::from_sec1_bytes(&de_b64(&chaves.publica).unwrap()).unwrap();
        let assinatura = Signature::from_slice(&de_b64(partes[2]).unwrap()).unwrap();
        verificador
            .verify(format!("{}.{}", partes[0], partes[1]).as_bytes(), &assinatura)
            .unwrap();
    }

    #[test]
    fn gerar_chaves_tamanhos() {
        let c = gerar_chaves();
        let publica = de_b64(&c.publica).unwrap();
        assert_eq!(publica.len(), 65);
        assert_eq!(publica[0], 0x04);
        assert_eq!(de_b64(&c.privada).unwrap().len(), 32);
    }
}
