import { useState, type FormEvent } from "react";
import { api, type Brutos, type Direcao, type Emprestimo, type NovoEmprestimo } from "../api";
import { Painel, Vazio } from "../componentes/Indicador";
import { aberto, falta, pago, porPessoa, totalEmAberto, vencido, type Pessoa } from "../emprestimos";
import { data, hojeISO, reais, lerValor } from "../formato";

type Form = { pessoa: string; direcao: Direcao; descricao: string; valor: string; data: string; vencimento: string; obs: string };

const formVazio = (direcao: Direcao = "me_deve"): Form => ({ pessoa: "", direcao, descricao: "", valor: "", data: hojeISO(), vencimento: "", obs: "" });


const valorNoCampo = (v: number) => v.toFixed(2).replace(".", ",");
const erro = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Pessoas({ brutos, aoMudar }: { brutos: Brutos; aoMudar: () => Promise<void> }) {
  const lista = brutos.emprestimos;
  const hoje = hojeISO();
  const [form, setForm] = useState<Form>(formVazio);
  const [editando, setEditando] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const meDevem = porPessoa(lista, "me_deve");
  const euDevo = porPessoa(lista, "eu_devo");
  const quitados = lista.filter((e) => !aberto(e)).sort((a, b) => b.data.localeCompare(a.data));
  const nomes = [...new Set(lista.map((e) => e.pessoa.trim()))].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const campo = (k: keyof Form) => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value }) });

  async function salvar(ev: FormEvent) {
    ev.preventDefault();
    const valor = lerValor(form.valor);
    if (!form.pessoa.trim() || valor === null || valor <= 0 || !form.data) {
      setMsg("Preencha o nome da pessoa, o valor e a data.");
      return;
    }
    const e: NovoEmprestimo = {
      pessoa: form.pessoa.trim(),
      direcao: form.direcao,
      descricao: form.descricao.trim() || null,
      valor,
      data: form.data,
      vencimento: form.vencimento || null,
      obs: form.obs.trim() || null,
    };
    setSalvando(true);
    setMsg("Salvando…");
    try {
      if (editando) await api.editarEmprestimo(editando, e);
      else await api.criarEmprestimo(e);
      await aoMudar();
      setMsg(editando ? "Empréstimo atualizado." : "Empréstimo anotado.");
      setForm(formVazio(form.direcao));
      setEditando(null);
    } catch (x) {
      setMsg(`Não consegui salvar: ${erro(x)}`);
    } finally {
      setSalvando(false);
    }
  }

  function editar(e: Emprestimo) {
    setEditando(e.id);
    setForm({
      pessoa: e.pessoa,
      direcao: e.direcao,
      descricao: e.descricao ?? "",
      valor: valorNoCampo(e.valor),
      data: e.data,
      vencimento: e.vencimento ?? "",
      obs: e.obs ?? "",
    });
    setMsg(null);
    document.getElementById("f-emp")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelar() {
    setEditando(null);
    setForm(formVazio(form.direcao));
    setMsg(null);
  }

  const totalMeDevem = totalEmAberto(lista, "me_deve");
  const totalEuDevo = totalEmAberto(lista, "eu_devo");
  const vencidos = lista.filter((e) => vencido(e, hoje));

  return (
    <>
      <section className="agora dois" aria-label="Resumo dos empréstimos">
        <div className="agora-item">
          <span className="rot">Me devem</span>
          <strong className="num grande pos">{reais(totalMeDevem)}</strong>
          <span className="nota">{resumo(meDevem)}</span>
        </div>
        <div className="agora-item">
          <span className="rot">Eu devo</span>
          <strong className={"num grande" + (totalEuDevo > 0 ? " neg" : "")}>{reais(totalEuDevo)}</strong>
          <span className="nota">{resumo(euDevo)}</span>
        </div>
      </section>
      {vencidos.length > 0 && (
        <p className="aviso-vencido" role="status">
          {vencidos.length === 1 ? "1 empréstimo passou" : `${vencidos.length} empréstimos passaram`} do vencimento combinado:{" "}
          {vencidos.map((e) => `${e.pessoa} (${data(e.vencimento)})`).join(", ")}.
        </p>
      )}

      <section className="grid">
        <Painel titulo="Me devem" descricao="Dinheiro que você emprestou ou pagou por alguém e ainda vai receber.">
          <ListaPessoas pessoas={meDevem} hoje={hoje} aoEditar={editar} aoMudar={aoMudar} vazio="Ninguém te deve nada agora." />
        </Painel>
        <Painel titulo="Eu devo" descricao="Dinheiro que alguém te emprestou e você ainda vai devolver.">
          <ListaPessoas pessoas={euDevo} hoje={hoje} aoEditar={editar} aoMudar={aoMudar} vazio="Você não deve nada a ninguém." />
        </Painel>

        <Painel titulo={editando ? "Editar empréstimo" : "Anotar empréstimo"} descricao="Fica só aqui, separado das contas do banco. Não entra no patrimônio.">
          <form className="f" id="f-emp" onSubmit={salvar} noValidate>
            <div className="field full">
              <span className="rotulo-campo" id="r-direcao">
                Quem deve
              </span>
              <div className="segmentos" role="group" aria-labelledby="r-direcao">
                <button type="button" aria-pressed={form.direcao === "me_deve"} onClick={() => setForm({ ...form, direcao: "me_deve" })}>
                  A pessoa me deve
                </button>
                <button type="button" aria-pressed={form.direcao === "eu_devo"} onClick={() => setForm({ ...form, direcao: "eu_devo" })}>
                  Eu devo à pessoa
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="e-pessoa">Pessoa</label>
              <input type="text" id="e-pessoa" list="l-pessoas" maxLength={80} autoComplete="off" placeholder="Nome ou apelido" {...campo("pessoa")} />
              <datalist id="l-pessoas">
                {nomes.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor="e-valor">Valor (R$)</label>
              <input type="text" inputMode="decimal" id="e-valor" placeholder="0,00" {...campo("valor")} />
            </div>
            <div className="field full">
              <label htmlFor="e-desc">Do que é (opcional)</label>
              <input type="text" id="e-desc" maxLength={120} placeholder="Ex.: conserto do carro, metade do aluguel" {...campo("descricao")} />
            </div>
            <div className="field">
              <label htmlFor="e-data">Data</label>
              <input type="date" id="e-data" {...campo("data")} />
            </div>
            <div className="field">
              <label htmlFor="e-venc">Combinado para (opcional)</label>
              <input type="date" id="e-venc" {...campo("vencimento")} />
            </div>
            <div className="field full">
              <label htmlFor="e-obs">Observação (opcional)</label>
              <input type="text" id="e-obs" maxLength={200} {...campo("obs")} />
            </div>
            <div className="row full">
              <button type="submit" className="primary" disabled={salvando}>
                {editando ? "Salvar alterações" : "Anotar empréstimo"}
              </button>
              {editando && (
                <button type="button" onClick={cancelar}>
                  Cancelar
                </button>
              )}
              {msg && (
                <span className="note" role="status">
                  {msg}
                </span>
              )}
            </div>
          </form>
        </Painel>

        <Painel titulo="Quitados" descricao="Empréstimos que já foram pagos por completo. Ficam guardados como histórico.">
          {quitados.length ? (
            <details>
              <summary>
                {quitados.length} {quitados.length === 1 ? "empréstimo quitado" : "empréstimos quitados"}
              </summary>
              <ul className="emp-quitados">
                {quitados.map((e) => (
                  <li key={e.id}>
                    <span>
                      <b>{e.pessoa}</b> {e.direcao === "me_deve" ? "te pagou" : "recebeu de você"} {reais(e.valor)}
                      {e.descricao ? ` (${e.descricao})` : ""}
                    </span>
                    <span className="note">
                      emprestado em {data(e.data)}
                      {e.pagamentos.length ? `, quitado em ${data(e.pagamentos[e.pagamentos.length - 1].data)}` : ""}
                    </span>
                    <AcoesEmprestimo e={e} aoEditar={editar} aoMudar={aoMudar} />
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="note">Nenhum empréstimo quitado ainda.</p>
          )}
        </Painel>
      </section>
    </>
  );
}

function resumo(p: Pessoa[]): string {
  if (!p.length) return "Nada em aberto";
  const n = p.reduce((a, x) => a + x.emprestimos.length, 0);
  return `${p.length} ${p.length === 1 ? "pessoa" : "pessoas"}, ${n} ${n === 1 ? "empréstimo" : "empréstimos"} em aberto`;
}

function ListaPessoas({ pessoas, hoje, aoEditar, aoMudar, vazio }: { pessoas: Pessoa[]; hoje: string; aoEditar: (e: Emprestimo) => void; aoMudar: () => Promise<void>; vazio: string }) {
  if (!pessoas.length) return <Vazio titulo={vazio}>Anote um empréstimo no formulário desta página.</Vazio>;
  return (
    <div className="pessoas">
      {pessoas.map((p) => (
        <section key={p.nome} className="pessoa" aria-label={p.nome}>
          <header>
            <h3>{p.nome}</h3>
            <strong className="num">{reais(p.total)}</strong>
          </header>
          <ul>
            {p.emprestimos.map((e) => (
              <ItemEmprestimo key={e.id} e={e} hoje={hoje} aoEditar={aoEditar} aoMudar={aoMudar} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ItemEmprestimo({ e, hoje, aoEditar, aoMudar }: { e: Emprestimo; hoje: string; aoEditar: (e: Emprestimo) => void; aoMudar: () => Promise<void> }) {
  const [pagando, setPagando] = useState(false);
  const [valor, setValor] = useState("");
  const [dataPg, setDataPg] = useState(hoje);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const resta = falta(e);
  const jaPago = pago(e);
  const pct = e.valor > 0 ? Math.min(100, (jaPago / e.valor) * 100) : 0;
  const atrasado = vencido(e, hoje);
  const verbo = e.direcao === "me_deve" ? "Recebi" : "Paguei";

  function abrir() {
    setPagando((v) => !v);
    setValor(valorNoCampo(resta));
    setDataPg(hoje);
    setMsg(null);
  }

  async function registrar(ev: FormEvent) {
    ev.preventDefault();
    const v = lerValor(valor);
    if (v === null || v <= 0) {
      setMsg("Informe o valor.");
      return;
    }
    if (v > resta + 0.004) {
      setMsg(`O valor passa do que falta (${reais(resta)}).`);
      return;
    }
    setOcupado(true);
    setMsg(null);
    try {
      await api.pagarEmprestimo(e.id, v, dataPg, null);
      setPagando(false);
      await aoMudar();
    } catch (x) {
      setMsg(`Não consegui registrar: ${erro(x)}`);
    } finally {
      setOcupado(false);
    }
  }

  async function desfazer(pid: string) {
    try {
      await api.desfazerPagamento(e.id, pid);
      await aoMudar();
    } catch (x) {
      setMsg(`Não consegui desfazer: ${erro(x)}`);
    }
  }

  return (
    <li className="emp">
      <div className="emp-linha">
        <span className="emp-nome">{e.descricao || "Empréstimo"}</span>
        <span className="num emp-falta">{reais(resta)}</span>
      </div>
      <div className="emp-meta">
        <span>desde {data(e.data)}</span>
        {e.vencimento && <span className={atrasado ? "pill warn" : ""}>{atrasado ? `venceu em ${data(e.vencimento)}` : `combinado para ${data(e.vencimento)}`}</span>}
        {jaPago > 0 && (
          <span>
            {reais(jaPago)} de {reais(e.valor)} já {e.direcao === "me_deve" ? "recebido" : "pago"}
          </span>
        )}
      </div>
      {jaPago > 0 && (
        <div className="medidor" role="img" aria-label={`${Math.round(pct)}% quitado`}>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      {e.obs && <p className="note">{e.obs}</p>}
      <div className="emp-acoes">
        <button type="button" className="btn-link" onClick={abrir} aria-expanded={pagando}>
          {verbo} uma parte ou tudo
        </button>
        <AcoesEmprestimo e={e} aoEditar={aoEditar} aoMudar={aoMudar} />
      </div>
      {pagando && (
        <form className="emp-pagar" onSubmit={registrar} noValidate>
          <div className="field">
            <label htmlFor={`pv-${e.id}`}>Valor (R$)</label>
            <input type="text" inputMode="decimal" id={`pv-${e.id}`} value={valor} onChange={(x) => setValor(x.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`pd-${e.id}`}>Data</label>
            <input type="date" id={`pd-${e.id}`} value={dataPg} onChange={(x) => setDataPg(x.target.value)} />
          </div>
          <button type="submit" className="primary" disabled={ocupado}>
            {ocupado ? "Registrando…" : "Registrar"}
          </button>
        </form>
      )}
      {msg && (
        <p className="erro" role="status">
          {msg}
        </p>
      )}
      {e.pagamentos.length > 0 && (
        <details className="emp-hist">
          <summary>
            {e.pagamentos.length} {e.pagamentos.length === 1 ? "pagamento registrado" : "pagamentos registrados"}
          </summary>
          <ul>
            {e.pagamentos.map((p) => (
              <li key={p.id}>
                <span>{data(p.data)}</span>
                <span className="num">{reais(p.valor)}</span>
                <button type="button" className="btn-link" onClick={() => desfazer(p.id)}>
                  desfazer
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function AcoesEmprestimo({ e, aoEditar, aoMudar }: { e: Emprestimo; aoEditar: (e: Emprestimo) => void; aoMudar: () => Promise<void> }) {
  const [confirmar, setConfirmar] = useState(false);
  const [falhou, setFalhou] = useState<string | null>(null);

  async function excluir() {
    if (!confirmar) {
      setConfirmar(true);
      return;
    }
    try {
      await api.excluirEmprestimo(e.id);
      await aoMudar();
    } catch (x) {
      setFalhou(erro(x));
    }
  }

  return (
    <span className="emp-mais">
      <button type="button" className="btn-link" onClick={() => aoEditar(e)}>
        editar
      </button>
      <button type="button" className={"btn-link" + (confirmar ? " perigo" : "")} onClick={excluir} onBlur={() => setConfirmar(false)}>
        {confirmar ? "toque de novo para excluir" : "excluir"}
      </button>
      {falhou && <span className="erro">{falhou}</span>}
    </span>
  );
}
