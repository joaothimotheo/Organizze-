#!/usr/bin/env python3
"""Teste de leitura da Pluggy (conector MeuPluggy), sem gravar nada no sistema.

Uso (na raiz do repositório):
    python3 scripts/pluggy_teste.py              # resumo dos últimos 90 dias
    python3 scripts/pluggy_teste.py --dias 30
    python3 scripts/pluggy_teste.py --salvar     # também grava a resposta crua em dados/pluggy-amostra.json

Lê do .env (ou do ambiente): PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET e PLUGGY_ITEM_ID.
Só faz leituras (GET), nunca pede atualização da conexão. O resumo mostra estrutura,
contagens e sinais dos valores; descrições aparecem cortadas e números de conta só
com os 4 últimos dígitos. A pasta dados/ fica fora do Git.
"""

import argparse
import collections
import datetime as dt
import json
import os
import pathlib
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.pluggy.ai"
RAIZ = pathlib.Path(__file__).resolve().parent.parent


def contexto_tls():
    """Python do python.org no Mac vem sem certificados; usa os do sistema (sem desligar a verificação)."""
    ctx = ssl.create_default_context()
    for cafile in ("/etc/ssl/cert.pem", "/opt/homebrew/etc/openssl@3/cert.pem", "/usr/local/etc/openssl@3/cert.pem"):
        if pathlib.Path(cafile).exists():
            ctx.load_verify_locations(cafile)
            break
    return ctx


TLS = contexto_tls()


def carregar_env():
    arq = RAIZ / ".env"
    if arq.exists():
        for linha in arq.read_text(encoding="utf-8").splitlines():
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            k, v = linha.split("=", 1)
            k = k.removeprefix("export ").strip()
            os.environ.setdefault(k, v.strip().strip('"').strip("'"))
    faltando = [k for k in ("PLUGGY_CLIENT_ID", "PLUGGY_CLIENT_SECRET", "PLUGGY_ITEM_ID") if not os.environ.get(k)]
    if faltando:
        sys.exit(f"Faltam no .env: {', '.join(faltando)}")


def pedir(metodo, caminho, chave=None, corpo=None):
    url = caminho if caminho.startswith("http") else API + caminho
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo)
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "financeiro/teste")
    if dados is not None:
        req.add_header("Content-Type", "application/json")
    if chave:
        req.add_header("X-API-KEY", chave)
    try:
        with urllib.request.urlopen(req, timeout=60, context=TLS) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        texto = e.read().decode("utf-8", "replace")[:400]
        sys.exit(f"Pluggy respondeu {e.code} em {metodo} {caminho.split('?')[0]}: {texto}")
    except urllib.error.URLError as e:
        sys.exit(f"Não consegui falar com a Pluggy: {e.reason}")


def final4(numero):
    s = "".join(c for c in str(numero or "") if c.isalnum())
    return f"…{s[-4:]}" if s else "-"


def brl(v):
    if v is None:
        return "-"
    s = f"{abs(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{'-' if v < 0 else ''}R$ {s}"


def data_br(iso):
    return iso[8:10] + "/" + iso[5:7] + "/" + iso[0:4] if iso else "-"


def todas_transacoes(chave, conta_id, de, ate):
    q = urllib.parse.urlencode({"accountId": conta_id, "dateFrom": de, "dateTo": ate})
    caminho = f"/v2/transactions?{q}"
    out = []
    while caminho:
        r = pedir("GET", caminho, chave)
        out += r.get("results", [])
        nxt = r.get("next")
        caminho = f"/v2/transactions{nxt}" if nxt else None
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=90)
    ap.add_argument("--salvar", action="store_true")
    a = ap.parse_args()
    carregar_env()

    chave = pedir("POST", "/auth", corpo={"clientId": os.environ["PLUGGY_CLIENT_ID"], "clientSecret": os.environ["PLUGGY_CLIENT_SECRET"]})["apiKey"]
    print("Autenticação: ok")

    item = pedir("GET", f"/items/{os.environ['PLUGGY_ITEM_ID']}", chave)
    print("\n== Conexão")
    print(f"conector: {item.get('connector', {}).get('name')} | status: {item.get('status')} | execução: {item.get('executionStatus')}")
    print(f"última atualização: {item.get('lastUpdatedAt')} | próxima automática: {item.get('nextAutoSyncAt')} | consentimento até: {item.get('consentExpiresAt')}")
    if item.get("error"):
        print(f"erro: {item['error'].get('code')} {item['error'].get('message')}")

    contas = pedir("GET", f"/accounts?itemId={os.environ['PLUGGY_ITEM_ID']}", chave).get("results", [])
    hoje = dt.date.today()
    de, ate = (hoje - dt.timedelta(days=a.dias)).isoformat(), hoje.isoformat()
    bruto = {"item": item, "contas": contas, "transacoes": {}}

    for c in contas:
        print(f"\n== Conta {c.get('type')}/{c.get('subtype')} · {c.get('name')} · {final4(c.get('number'))} · moeda {c.get('currencyCode')}")
        print(f"saldo (campo balance): {c.get('balance')}")
        if c.get("creditData"):
            cd = c["creditData"]
            print(f"cartão: limite {cd.get('creditLimit')} · disponível {cd.get('availableCreditLimit')} · fecha {cd.get('balanceCloseDate')} · vence {cd.get('balanceDueDate')}")
        txs = todas_transacoes(chave, c["id"], de, ate)
        bruto["transacoes"][c["id"]] = txs
        print(f"transações de {data_br(de)} a {data_br(ate)}: {len(txs)}")
        if not txs:
            continue

        sinais = collections.Counter((t.get("type"), t.get("status"), "neg" if (t.get("amount") or 0) < 0 else "pos") for t in txs)
        print("tipo/status/sinal: " + ", ".join(f"{k[0]}/{k[1]}/{k[2]}={n}" for k, n in sorted(sinais.items(), key=str)))
        campos = collections.Counter(k for t in txs for k, v in t.items() if v not in (None, "", [], {}))
        print("campos preenchidos: " + ", ".join(f"{k}({n})" for k, n in campos.most_common()))
        cats = collections.Counter(t.get("category") or "(sem)" for t in txs)
        print("categorias da Pluggy (top 10): " + ", ".join(f"{k}={n}" for k, n in cats.most_common(10)))
        parc = [t for t in txs if (t.get("creditCardMetadata") or {}).get("totalInstallments")]
        if parc:
            print(f"parceladas: {len(parc)} (ex.: parcela {parc[0]['creditCardMetadata'].get('installmentNumber')}/{parc[0]['creditCardMetadata'].get('totalInstallments')})")
        ids = [t["id"] for t in txs]
        print(f"ids únicos: {len(set(ids))} de {len(ids)} | datas: {min(t['date'] for t in txs)[:10]} a {max(t['date'] for t in txs)[:10]}")
        print("amostra (5 mais recentes):")
        for t in sorted(txs, key=lambda t: t["date"], reverse=True)[:5]:
            desc = (t.get("description") or "")[:28]
            print(f"  {data_br(t['date'][:10])} {t.get('type'):6} {t.get('status'):7} {brl(t.get('amount')):>14}  {desc}")

    if a.salvar:
        destino = RAIZ / "dados" / "pluggy-amostra.json"
        destino.parent.mkdir(exist_ok=True)
        destino.write_text(json.dumps(bruto, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nResposta crua salva em {destino.relative_to(RAIZ)} (fora do Git)")


if __name__ == "__main__":
    main()
