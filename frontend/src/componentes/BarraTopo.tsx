import { useEffect, useRef, useState } from "react";
import { api, SemSessao, type EstadoSync } from "../api";
import { mensagemDepoisDeAtualizar, problemaNaConexao, textoAtualizado } from "../conexao";
import { capitalizar, MESES } from "../formato";
import { mesVizinho } from "../navegacao";
import { Icone } from "./Menu";

export function IconeOlho({ fechado }: { fechado: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {fechado && <path d="M4 4l16 16" />}
    </svg>
  );
}

/** Barra fixa no alto de todas as telas: mês, pendentes, atualizar e esconder valores. */
export default function BarraTopo({
  ano,
  mes,
  anos,
  aoMudarPeriodo,
  comPeriodo = true,
  comBanco = true,
  pendentes,
  aoPendentes,
  ocultar,
  aoOcultar,
  carregadoEm,
  aoSincronizado,
}: {
  ano: number;
  mes: number | null;
  anos: number[];
  aoMudarPeriodo: (ano: number, mes: number | null) => void;
  /** No modo simples o período é sempre o mês atual: mostra o nome do mês sem deixar trocar. */
  comPeriodo?: boolean;
  /** Modo documentos: Atualizar só recarrega os dados e não há conexão com o banco para vigiar. */
  comBanco?: boolean;
  pendentes: number;
  aoPendentes: () => void;
  ocultar: boolean;
  aoOcultar: () => void;
  carregadoEm: Date | null;
  aoSincronizado: () => void | Promise<void>;
}) {
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [estado, setEstado] = useState<EstadoSync | null>(null);

  // Relê o estado da conexão a cada carga de dados (inclusive depois de sincronizar em Ajustes).
  useEffect(() => {
    if (!comBanco) {
      setEstado(null);
      return;
    }
    let vivo = true;
    api.sincronizacao().then(
      (e) => vivo && setEstado(e),
      (e) => {
        if (vivo && !(e instanceof SemSessao)) setEstado(null);
      },
    );
    return () => {
      vivo = false;
    };
  }, [comBanco, carregadoEm]);

  useEffect(() => () => {
    if (relogio.current) clearTimeout(relogio.current);
  }, []);

  async function atualizar() {
    setRodando(true);
    setErro(null);
    setInfo(null);
    try {
      // Sem banco configurado no servidor, Atualizar só recarrega os dados.
      if (comBanco && estado?.configurada !== false) {
        await api.sincronizar();
        // A sincronização só traz o que o Open Finance já leu do banco: diga de quando são os dados
        // e quando ele renova de novo, para não parecer que o saldo é de agora.
        const novo = await api.sincronizacao().catch(() => null);
        if (novo) setEstado(novo);
        const t = mensagemDepoisDeAtualizar(novo);
        if (t) {
          setInfo(t);
          if (relogio.current) clearTimeout(relogio.current);
          relogio.current = setTimeout(() => setInfo(null), 10000);
        }
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      if (relogio.current) clearTimeout(relogio.current);
      relogio.current = setTimeout(() => setErro(null), 4000);
    } finally {
      setRodando(false);
    }
    await aoSincronizado();
  }

  const andar = (passo: 1 | -1) => {
    const v = mesVizinho(ano, mes, passo);
    aoMudarPeriodo(v.ano, v.mes);
  };
  const listaAnos = [...new Set([...anos, ano])].sort((a, b) => b - a);
  const aviso = comBanco ? problemaNaConexao(estado) : null;
  const atualizado = textoAtualizado(comBanco, estado, carregadoEm);
  const nomePeriodo = mes === null ? `Ano de ${ano}` : `${capitalizar(MESES[mes - 1])} de ${ano}`;

  return (
    <header className="appbar">
      {comPeriodo ? (
        <div className="mes" role="group" aria-label="Período">
          <button type="button" onClick={() => andar(-1)} aria-label={mes === null ? "Ano anterior" : "Mês anterior"} title={mes === null ? "Ano anterior" : "Mês anterior"}>
            <Icone nome="esq" />
          </button>
          <select aria-label="Mês" value={mes ?? "todos"} onChange={(e) => aoMudarPeriodo(ano, e.target.value === "todos" ? null : Number(e.target.value))}>
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>
                {capitalizar(m)}
              </option>
            ))}
            <option value="todos">Ano inteiro</option>
          </select>
          <select aria-label="Ano" value={ano} onChange={(e) => aoMudarPeriodo(Number(e.target.value), mes)}>
            {listaAnos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => andar(1)} aria-label={mes === null ? "Próximo ano" : "Próximo mês"} title={mes === null ? "Próximo ano" : "Próximo mês"}>
            <Icone nome="dir" />
          </button>
        </div>
      ) : (
        <span className="mes mes-fixo">{nomePeriodo}</span>
      )}
      <span className="appbar-espaco" />
      <button
        type="button"
        className={"pchip" + (pendentes ? "" : " ok")}
        onClick={aoPendentes}
        aria-label={pendentes ? `${pendentes} para organizar` : "Tudo organizado"}
      >
        {pendentes ? (
          <>
            {pendentes}
            <span className="pchip-texto"> para organizar</span>
          </>
        ) : (
          <>
            <span className="pchip-curto">OK</span>
            <span className="pchip-texto">Tudo organizado</span>
          </>
        )}
      </button>
      {aviso?.nivel && (
        <a className="aviso-conexao" href="#ajustes" title={aviso.texto} aria-label={`${aviso.texto}: ver em Ajustes`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l10 18H2z" />
            <path d="M12 10v5M12 18h.01" />
          </svg>
          <span className="aviso-conexao-texto">{aviso.texto}</span>
        </a>
      )}
      {atualizado && <span className="appbar-hora" title="Hora em que o Open Finance leu o seu banco. Ele renova os dados uma vez por dia.">{rodando ? "Atualizando…" : atualizado}</span>}
      <button
        type="button"
        className={"icon-btn" + (rodando ? " girando" : "")}
        onClick={atualizar}
        disabled={rodando}
        aria-label={comBanco ? "Atualizar bancos" : "Recarregar dados"}
        title={comBanco ? "Atualizar bancos" : "Recarregar dados"}
      >
        <Icone nome="sync" />
      </button>
      <button type="button" className="icon-btn" onClick={aoOcultar} aria-pressed={ocultar} aria-label={ocultar ? "Mostrar valores" : "Esconder valores"} title={ocultar ? "Mostrar valores" : "Esconder valores"}>
        <IconeOlho fechado={ocultar} />
      </button>
      {erro && (
        <div className="appbar-erro" role="alert">
          Não consegui atualizar: {erro}
        </div>
      )}
      {!erro && info && (
        <div className="appbar-info" role="status">
          {info}
          <button type="button" className="appbar-info-fechar" onClick={() => setInfo(null)} aria-label="Fechar aviso">
            ×
          </button>
        </div>
      )}
    </header>
  );
}
