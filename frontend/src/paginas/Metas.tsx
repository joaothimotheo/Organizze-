import { useEffect, useState, type FormEvent } from "react";
import { api, idsReserva, SemSessao, type Brutos, type EstadoSync, type Meta, type NovaMeta } from "../api";
import { Painel, Vazio } from "../componentes/Indicador";
import { addMes, data, hojeISO, lerValor, mesAno, numero, reais } from "../formato";
import { guardadoNaMeta, porMesAte, saldoReserva } from "../plano";

const erroDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const noCampo = (v: number | null | undefined) => (v == null ? "" : v.toFixed(2).replace(".", ","));

interface Form {
  nome: string;
  valor_alvo: string;
  saldo_reservado: string;
  prazo: string;
  aporte: string;
  usar_reserva: boolean;
}
const vazio: Form = { nome: "", valor_alvo: "", saldo_reservado: "", prazo: "", aporte: "", usar_reserva: false };

interface Previsao {
  /** O valor por mês do simulador da aba Objetivos. */
  porMes?: number;
  /** Mês em que cada meta (por id) é alcançada no simulador, depois das dívidas. */
  previsoes?: Map<string, string | null>;
  /** Primeiro mês da simulação. */
  inicio?: string;
}

export default function Metas({ brutos, aoMudar, porMes, previsoes, inicio = addMes(hojeISO().slice(0, 7), 1) }: { brutos: Brutos; aoMudar: () => Promise<void> } & Previsao) {
  const [sync, setSync] = useState<EstadoSync | null>(null);
  const [form, setForm] = useState<Form>(vazio);
  const [editando, setEditando] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    api.sincronizacao().then(setSync, (e) => {
      if (!(e instanceof SemSessao)) setSync(null);
    });
  }, []);

  const reservas = idsReserva(brutos.contas);
  const reserva = saldoReserva(sync?.ultima_ok?.contas, reservas);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const alvo = lerValor(form.valor_alvo);
    if (!form.nome.trim() || alvo === null || alvo <= 0) {
      setMsg("Informe o nome e o valor da meta.");
      return;
    }
    const m: NovaMeta = {
      nome: form.nome.trim(),
      valor_alvo: alvo,
      saldo_reservado: lerValor(form.saldo_reservado) ?? 0,
      prazo: form.prazo || null,
      aporte_mensal_planejado: lerValor(form.aporte),
      usar_reserva: form.usar_reserva,
    };
    setSalvando(true);
    setMsg(null);
    try {
      if (editando) await api.editarMeta(editando, m);
      else await api.criarMeta(m);
      setForm(vazio);
      setEditando(null);
      await aoMudar();
    } catch (x) {
      setMsg(erroDe(x));
    } finally {
      setSalvando(false);
    }
  }

  function editar(m: Meta) {
    setEditando(m.id);
    setForm({
      nome: m.nome,
      valor_alvo: noCampo(m.valor_alvo),
      saldo_reservado: noCampo(m.saldo_reservado),
      prazo: m.prazo ?? "",
      aporte: noCampo(m.aporte_mensal_planejado),
      usar_reserva: !!m.usar_reserva,
    });
    setMsg(null);
  }

  const campo = (k: Exclude<keyof Form, "usar_reserva">) => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value }) });

  return (
    <section className="grid">
      <Painel largo titulo="Suas metas" descricao="Quanto falta para cada objetivo e as duas contas: quando você chega lá e quanto guardar por mês para chegar no prazo.">
        {brutos.metas.length ? (
          <ul className="metas">
            {brutos.metas.map((m) => (
              <ItemMeta key={m.id} m={m} reserva={reserva} porMes={porMes} previsao={previsoes?.get(m.id)} inicio={inicio} aoEditar={() => editar(m)} aoMudar={aoMudar} />
            ))}
          </ul>
        ) : (
          <Vazio titulo="Nenhuma meta ainda">Crie a primeira meta ao lado, por exemplo uma reserva de emergência ou uma viagem.</Vazio>
        )}
      </Painel>

      <Painel titulo={editando ? "Editar meta" : "Nova meta"} descricao="Valores no formato 1.234,56.">
        <form className="f" onSubmit={salvar} noValidate>
          <div className="field full">
            <label htmlFor="m-nome">Nome</label>
            <input id="m-nome" type="text" maxLength={80} placeholder="Ex.: Reserva de emergência" {...campo("nome")} />
          </div>
          <div className="field">
            <label htmlFor="m-alvo">Valor da meta (R$)</label>
            <input id="m-alvo" type="text" inputMode="decimal" {...campo("valor_alvo")} />
          </div>
          <label className="check full">
            <input type="checkbox" checked={form.usar_reserva} onChange={(e) => setForm({ ...form, usar_reserva: e.target.checked })} />
            Acompanhar o saldo da reserva (conta marcada como Reserva em Ajustes)
          </label>
          {!form.usar_reserva && (
            <div className="field">
              <label htmlFor="m-guardado">Já guardado (R$)</label>
              <input id="m-guardado" type="text" inputMode="decimal" placeholder="0,00" {...campo("saldo_reservado")} />
            </div>
          )}
          <div className="field">
            <label htmlFor="m-aporte">Quanto pretende guardar por mês (R$, opcional)</label>
            <input id="m-aporte" type="text" inputMode="decimal" {...campo("aporte")} />
          </div>
          <div className="field">
            <label htmlFor="m-prazo">Prazo (opcional)</label>
            <input id="m-prazo" type="date" {...campo("prazo")} />
          </div>
          {msg && <div className="erro full">{msg}</div>}
          <div className="full row">
            <button type="submit" className="primary" disabled={salvando}>
              {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Criar meta"}
            </button>
            {editando && (
              <button type="button" onClick={() => (setEditando(null), setForm(vazio), setMsg(null))}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </Painel>
    </section>
  );
}

function ItemMeta({
  m,
  reserva,
  porMes,
  previsao,
  inicio,
  aoEditar,
  aoMudar,
}: {
  m: Meta;
  reserva: number | null;
  porMes?: number;
  previsao?: string | null;
  inicio: string;
  aoEditar: () => void;
  aoMudar: () => Promise<void>;
}) {
  const [valor, setValor] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const guardado = guardadoNaMeta(m, reserva);
  const pct = m.valor_alvo > 0 ? Math.min(100, (guardado / m.valor_alvo) * 100) : 0;
  const falta = Math.max(0, m.valor_alvo - guardado);
  const meses = m.aporte_mensal_planejado && m.aporte_mensal_planejado > 0 && falta > 0 ? Math.ceil(falta / m.aporte_mensal_planejado) : null;
  const prazoMes = m.prazo ? m.prazo.slice(0, 7) : null;
  const precisa = prazoMes && falta > 0 ? porMesAte(falta, inicio, prazoMes) : null;

  async function rodar(f: () => Promise<unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      await f();
      setValor("");
      await aoMudar();
    } catch (x) {
      setErro(erroDe(x));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="meta">
      <div className="meta-topo">
        <b>{m.nome}</b>
        <span className="num">
          {reais(guardado)} de {reais(m.valor_alvo)}
        </span>
      </div>
      <div className="medidor" role="img" aria-label={`${numero(Math.round(pct))}% da meta`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="note">
        {falta > 0 ? `Faltam ${reais(falta)} (${numero(Math.round(pct))}%)` : "Meta alcançada"}
        {m.prazo && `. Prazo: ${data(m.prazo)}`}
        {m.usar_reserva && (reserva !== null ? ". Acompanha o saldo da reserva" : ". Vai acompanhar a reserva quando ela sincronizar; até lá vale o valor anotado")}
      </span>
      {falta > 0 && (meses || precisa !== null || prazoMes || previsao !== undefined) && (
        <div className="meta-conta">
          {previsao !== undefined && porMes !== undefined && (
            <span>
              Com {reais(porMes)} por mês no simulador, depois das dívidas
              <b>{previsao ? mesAno(previsao) : "mais de 10 anos"}</b>
            </span>
          )}
          {meses && (
            <span>
              Só esta meta, guardando {reais(m.aporte_mensal_planejado!)} por mês
              <b>{mesAno(addMes(inicio, meses - 1))}</b>
            </span>
          )}
          {prazoMes && (
            <span>
              Para chegar até {mesAno(prazoMes)}
              <b>{precisa === null ? "o prazo já passou" : `${reais(precisa)} por mês`}</b>
            </span>
          )}
        </div>
      )}
      {!m.usar_reserva && (
        <form
          className="cat-nova"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const v = lerValor(valor);
            if (v) rodar(() => api.guardarNaMeta(m.id, v));
          }}
        >
          <input type="text" inputMode="decimal" placeholder="Valor (use - para tirar)" aria-label={`Valor para guardar em ${m.nome}`} value={valor} onChange={(e) => setValor(e.target.value)} />
          <button type="submit" className="primary" disabled={ocupado || !lerValor(valor)}>
            Guardar
          </button>
        </form>
      )}
      <span className="cat-acoes">
        <button type="button" className="btn-link" onClick={aoEditar}>
          Editar
        </button>
        {confirmar ? (
          <button type="button" className="btn-link perigo" disabled={ocupado} onClick={() => rodar(() => api.excluirMeta(m.id))}>
            Confirmar exclusão
          </button>
        ) : (
          <button type="button" className="btn-link" onClick={() => setConfirmar(true)}>
            Excluir
          </button>
        )}
      </span>
      {erro && <span className="cat-erro">{erro}</span>}
    </li>
  );
}
