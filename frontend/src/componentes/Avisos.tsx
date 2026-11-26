import { useCallback, useEffect, useState } from "react";
import { api, type EstadoAvisos, type TiposAvisos } from "../api";
import { ativar, desativarEste, idDesteAparelho, suportado } from "../avisos";
import { Painel } from "./Indicador";

const TIPOS: [keyof TiposAvisos, string][] = [
  ["fixa_vencendo", "Conta fixa vencendo"],
  ["assinatura_nova", "Cobrança que parece assinatura"],
  ["fatura", "Fatura do cartão"],
  ["fechamento_mes", "Resumo do mês"],
  ["orcamento", "Limite de gasto por categoria"],
];

const BLOQUEADO = "As notificações estão bloqueadas. No Chrome, toque nos três pontinhos → Configurações → Notificações e libere este site.";
const SEM_SUPORTE = "Este navegador não recebe avisos. No celular, instale o app pela tela de início.";

export default function Avisos() {
  const [estado, setEstado] = useState<EstadoAvisos | null>(null);
  const [esteId, setEsteId] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setEstado(await api.avisos());
      setEsteId(await idDesteAparelho());
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function executar(f: () => Promise<string | null | void>) {
    setOcupado(true);
    setErro(null);
    setMsg(null);
    try {
      const m = await f();
      if (m) setMsg(m);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  const bloqueado = suportado() && Notification.permission === "denied";
  const ativo = esteId !== null && !!estado?.aparelhos.some((a) => a.id === esteId);

  return (
    <Painel titulo="Avisos no celular" descricao="Receba um aviso quando uma conta fixa estiver para vencer, quando a fatura fechar e no resumo do mês.">
      {!suportado() ? (
        <p className="callout">{SEM_SUPORTE}</p>
      ) : (
        <>
          <div className="linha-acoes">
            {ativo ? (
              <>
                <span className="pill ok">Avisos ativos neste aparelho</span>
                <button type="button" disabled={ocupado} onClick={() => executar(async () => void (await desativarEste()))}>
                  Desativar
                </button>
              </>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={ocupado || !estado || bloqueado}
                onClick={() =>
                  executar(async () => {
                    const r = await ativar(estado!.chave_publica);
                    return r === "negado" ? BLOQUEADO : r === "sem_suporte" ? SEM_SUPORTE : null;
                  })
                }
              >
                Ativar avisos neste aparelho
              </button>
            )}
          </div>
          {bloqueado && !msg && <p className="callout">{BLOQUEADO}</p>}
        </>
      )}

      {estado && (
        <>
          <div className="avisos-tipos">
            {TIPOS.map(([chave, nome]) => (
              <label key={chave} className="check">
                <input
                  type="checkbox"
                  checked={estado.tipos[chave]}
                  disabled={ocupado}
                  onChange={(e) => executar(async () => void (await api.tiposAvisos({ ...estado.tipos, [chave]: e.target.checked })))}
                />{" "}
                {nome}
              </label>
            ))}
          </div>

          <div className="linha-acoes">
            <button
              type="button"
              disabled={ocupado || estado.aparelhos.length === 0}
              onClick={() =>
                executar(async () => {
                  const r = await api.testarAvisos();
                  return `Enviado para ${r.enviados} aparelho${r.enviados === 1 ? "" : "s"}`;
                })
              }
            >
              Enviar aviso de teste
            </button>
          </div>

          {estado.aparelhos.length > 0 && (
            <ul className="avisos-aparelhos">
              {estado.aparelhos.map((a) => (
                <li key={a.id}>
                  <span>
                    <b>{a.nome}</b>
                    {a.id === esteId && " (este aparelho)"}
                  </span>
                  <button
                    type="button"
                    className="btn-link"
                    disabled={ocupado}
                    onClick={() =>
                      executar(async () => {
                        if (a.id === esteId) await desativarEste();
                        else await api.removerAparelho(a.id);
                      })
                    }
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {msg && <p className="note" role="status">{msg}</p>}
      {erro && <p className="callout" role="alert">{erro}</p>}
      <p className="note">Os avisos chegam depois das atualizações automáticas (8h, 12h, 16h30, 19h e 22h) e mostram valores.</p>
    </Painel>
  );
}
