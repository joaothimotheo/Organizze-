import { useCallback, useEffect, useState } from "react";
import { api, SemSessao, type EstadoSync, type ExecucaoSync } from "../api";

const DIA = 24 * 3600 * 1000;

function quando(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function resumo(e: ExecucaoSync): string {
  const t = (e.contas ?? []).reduce(
    (a, c) => ({ novas: a.novas + (c.contagem?.novas ?? 0), atualizadas: a.atualizadas + (c.contagem?.atualizadas ?? 0), removidas: a.removidas + (c.contagem?.removidas ?? 0) }),
    { novas: 0, atualizadas: 0, removidas: 0 },
  );
  const tr = e.transferencias_entre_contas ?? 0;
  const extra = tr ? ` ${tr} ${tr === 1 ? "transferência entre as suas contas reconhecida" : "transferências entre as suas contas reconhecidas"}.` : "";
  if (!t.novas && !t.atualizadas && !t.removidas) return "Tudo em dia: nenhum lançamento novo." + extra;
  const partes = [
    t.novas && `${t.novas} ${t.novas === 1 ? "lançamento novo" : "lançamentos novos"}`,
    t.atualizadas && `${t.atualizadas} ${t.atualizadas === 1 ? "atualizado" : "atualizados"}`,
    t.removidas && `${t.removidas} ${t.removidas === 1 ? "removido" : "removidos"}`,
  ].filter(Boolean);
  return partes.join(", ") + "." + extra;
}

/** Avisos sobre as conexões com os bancos que pedem alguma ação sua. */
function alertas(e: ExecucaoSync | null): string[] {
  const conexoes = e?.conexoes ?? (e?.conexao ? [e.conexao] : []);
  const out: string[] = [];
  for (const c of conexoes) {
    const banco = c.instituicao ? `com ${c.instituicao}` : "com o banco";
    if (c.erro) {
      out.push(`Não consegui ler a conexão ${banco}: ${c.erro}`);
      continue;
    }
    if (c.status && c.status !== "UPDATED" && c.status !== "UPDATING") {
      out.push(`A conexão ${banco} precisa de atenção no meu.pluggy.ai (abra Conexões e renove a autorização).`);
    }
    if (c.consentimento_ate) {
      const dias = Math.floor((new Date(c.consentimento_ate).getTime() - Date.now()) / DIA);
      if (dias <= 30) out.push(`A autorização do Open Finance ${banco} vence em ${Math.max(dias, 0)} dia(s), em ${quando(c.consentimento_ate).slice(0, 10)}. Renove no meu.pluggy.ai.`);
    }
  }
  return out;
}

export default function Sincronizacao({ aoSincronizar }: { aoSincronizar: () => void | Promise<void> }) {
  const [estado, setEstado] = useState<EstadoSync | null>(null);
  const [rodando, setRodando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const ler = useCallback(async () => {
    try {
      setEstado(await api.sincronizacao());
    } catch (e) {
      if (!(e instanceof SemSessao)) setEstado(null);
    }
  }, []);

  useEffect(() => {
    ler();
  }, [ler]);

  async function sincronizar() {
    setRodando(true);
    setMensagem(null);
    try {
      const r = await api.sincronizar();
      setMensagem({ tipo: "ok", texto: resumo(r) });
      await aoSincronizar();
    } catch (e) {
      setMensagem({ tipo: "erro", texto: `Não consegui sincronizar: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setRodando(false);
      ler();
    }
  }

  if (!estado?.configurada) return null;
  const ultima = estado.ultima;
  const falhou = ultima && !ultima.ok;
  const atrasada = estado.ultima_ok && Date.now() - new Date(estado.ultima_ok.em).getTime() > 2 * DIA;
  const avisos = alertas(estado.ultima_ok);
  const cor = falhou || avisos.length ? "bad" : !estado.ultima_ok || atrasada ? "warn" : "ok";

  return (
    <>
      <span className="chip">
        <span className={"dot " + cor} />
        {estado.ultima_ok ? `Banco sincronizado em ${quando(estado.ultima_ok.em)}` : "Banco: nenhuma sincronização ainda"}
        <button type="button" className="btn-link" onClick={sincronizar} disabled={rodando}>
          {rodando ? "sincronizando…" : "sincronizar agora"}
        </button>
      </span>
      {(mensagem || falhou || avisos.length > 0) && (
        <div className="aviso-sync" role="status">
          {mensagem && <div className={mensagem.tipo === "erro" ? "erro" : "note"}>{mensagem.texto}</div>}
          {!mensagem && falhou && <div className="erro">A última sincronização ({quando(ultima.em)}) falhou: {ultima.erro}</div>}
          {avisos.map((a) => (
            <div key={a} className="erro">
              {a}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Busca de novo o último ano no banco (o que já existe não é duplicado). */
export function BuscarHistorico({ aoSincronizar }: { aoSincronizar: () => void | Promise<void> }) {
  const [configurada, setConfigurada] = useState<boolean | null>(null);
  const [rodando, setRodando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  useEffect(() => {
    api.sincronizacao().then(
      (e) => setConfigurada(e.configurada),
      () => setConfigurada(false),
    );
  }, []);

  async function buscar() {
    setRodando(true);
    setMensagem(null);
    try {
      const r = await api.sincronizar(365);
      setMensagem({ tipo: "ok", texto: resumo(r) });
      await aoSincronizar();
    } catch (e) {
      setMensagem({ tipo: "erro", texto: `Não consegui buscar: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setRodando(false);
    }
  }

  if (configurada === null) return null;
  if (!configurada) return <p className="note">A conexão com o banco não está configurada neste servidor.</p>;
  return (
    <>
      <p className="note">
        Busca no banco os lançamentos dos últimos 12 meses, o máximo que o Open Finance libera. O que já está aqui não é duplicado e as categorias que você
        escolheu continuam. Os meses que vieram do PDF da fatura do cartão não são trocados. Pode levar até um minuto.
      </p>
      <button type="button" className="primary" onClick={buscar} disabled={rodando}>
        {rodando ? "Buscando… (pode levar um minuto)" : "Buscar os últimos 12 meses"}
      </button>
      {mensagem && (
        <div className={mensagem.tipo === "erro" ? "erro" : "note"} role="status">
          {mensagem.texto}
        </div>
      )}
    </>
  );
}
