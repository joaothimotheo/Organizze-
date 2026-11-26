import { useMemo, useState, type FormEvent } from "react";
import { api, type Brutos, type Fixa, type FormaPagamento, type NovaFixa } from "../api";
import { SeletorCategoria } from "../componentes/SeletorCategoria";
import { Painel, Vazio } from "../componentes/Indicador";
import { tituloDe } from "../componentes/NomeLancamento";
import { categoriaDaFixa, cobradaDepois, FORMAS, nomeForma, resumo, situacao, sugestoes, type Sugestao } from "../fixas";
import { data, hojeISO, lerValor, MESES, mesAno, nomeCategoria, reais } from "../formato";

const erroDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const noCampo = (v: number | null | undefined) => (v == null ? "" : v.toFixed(2).replace(".", ","));

interface Form {
  nome: string;
  valor: string;
  dia: string;
  forma: FormaPagamento;
  categoria: string;
  busca: string;
}
// Categoria vazia = o padrão de `categoriaDaFixa` (depende de já ter migrado).
const vazio: Form = { nome: "", valor: "", dia: "", forma: "pix", categoria: "", busca: "" };

export default function Fixas({ brutos, aoMudar, ano, mes: mesTopo }: { brutos: Brutos; aoMudar: () => Promise<void>; ano: number; mes: number | null }) {
  const hoje = hojeISO();
  const mesAtual = hoje.slice(0, 7);
  // Mês do topo; "ano inteiro" (sem mês) usa o mês atual.
  const mesVisto = mesTopo === null ? mesAtual : `${ano}-${String(mesTopo).padStart(2, "0")}`;
  // Dia de hoje no mês atual; 32 num mês passado (tudo já venceu); 0 num futuro (tudo a vencer).
  const diaHoje = Number(hoje.slice(8, 10));
  const diaVisto = mesVisto === mesAtual ? diaHoje : mesVisto < mesAtual ? 32 : 0;
  const noAtual = mesVisto === mesAtual;
  const nomeVisto = `${MESES[Number(mesVisto.slice(5, 7)) - 1]}/${mesVisto.slice(0, 4)}`;
  const [form, setForm] = useState<Form>(vazio);
  const [editando, setEditando] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const migrado = !!brutos.categoriasMigradas;
  const categoriaDe = (c: string | null | undefined) => categoriaDaFixa(c, migrado);
  const tipoConta = useMemo(() => new Map(brutos.contas.map((c) => [c.id, c.tipo ?? ""])), [brutos.contas]);
  const r = resumo(brutos.fixas, brutos.movimentacoes, mesVisto, diaVisto);
  const ordem = (a: Fixa, b: Fixa) => (a.dia ?? 99) - (b.dia ?? 99) || a.nome.localeCompare(b.nome);
  const lista = brutos.fixas.filter((f) => f.ativa).sort(ordem);
  const canceladas = brutos.fixas.filter((f) => !f.ativa).sort((a, b) => (b.cancelada_em ?? "").localeCompare(a.cancelada_em ?? "") || ordem(a, b));
  const sug = useMemo(
    () => sugestoes(brutos.movimentacoes, brutos.fixas, mesAtual, tipoConta, brutos.fixasIgnoradas, brutos.categorias),
    [brutos.movimentacoes, brutos.fixas, mesAtual, tipoConta, brutos.fixasIgnoradas, brutos.categorias],
  );
  const [ignorando, setIgnorando] = useState<string | null>(null);
  const [erroSug, setErroSug] = useState<string | null>(null);

  async function ignorar(chave: string, sim: boolean) {
    setIgnorando(chave);
    setErroSug(null);
    try {
      await api.ignorarSugestao(chave, sim);
      await aoMudar();
    } catch (x) {
      setErroSug(erroDe(x));
    } finally {
      setIgnorando(null);
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const valor = lerValor(form.valor);
    const dia = form.dia ? Number(form.dia) : null;
    if (!form.nome.trim() || valor === null || valor <= 0) return setMsg("Informe o nome e o valor.");
    if (dia !== null && !(dia >= 1 && dia <= 31)) return setMsg("O dia deve estar entre 1 e 31.");
    const atual = editando ? brutos.fixas.find((f) => f.id === editando) : null;
    const f: NovaFixa = { nome: form.nome.trim(), valor, dia, forma: form.forma, categoria: categoriaDe(form.categoria), busca: form.busca.trim() || null, ativa: atual?.ativa ?? true };
    setSalvando(true);
    setMsg(null);
    try {
      if (editando) await api.editarFixa(editando, f);
      else await api.criarFixa(f);
      setForm(vazio);
      setEditando(null);
      await aoMudar();
    } catch (x) {
      setMsg(erroDe(x));
    } finally {
      setSalvando(false);
    }
  }

  function editar(f: Fixa) {
    setEditando(f.id);
    setForm({ nome: f.nome, valor: noCampo(f.valor), dia: f.dia ? String(f.dia) : "", forma: f.forma, categoria: f.categoria ?? "", busca: f.busca ?? "" });
    setMsg(null);
    document.getElementById("fixa-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const [adicionando, setAdicionando] = useState<string | null>(null);

  /** Salva a sugestão direto como conta fixa, já com o texto para achar no banco. */
  async function adicionarSugestao(s: Sugestao) {
    setAdicionando(s.chave);
    setErroSug(null);
    try {
      await api.criarFixa({ nome: s.nome, valor: s.valor, dia: s.dia, forma: s.forma, categoria: categoriaDe(s.categoria), busca: s.chave, ativa: true });
      await aoMudar();
    } catch (x) {
      setErroSug(erroDe(x));
    } finally {
      setAdicionando(null);
    }
  }

  function usarSugestao(s: Sugestao) {
    setEditando(null);
    setForm({ nome: s.nome, valor: noCampo(s.valor), dia: String(s.dia), forma: s.forma, categoria: categoriaDe(s.categoria), busca: s.chave });
    setMsg(null);
    document.getElementById("fixa-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const campo = (k: "nome" | "valor" | "dia" | "busca") => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value }) });
  const porFora = form.forma === "pix" || form.forma === "dinheiro";

  return (
    <section className="grid">
      <div className="agora quatro wide" role="group" aria-label={noAtual ? `Contas fixas em ${mesAno(mesAtual)}` : `Contas fixas de ${nomeVisto}`}>
        <div className="agora-item">
          <span className="rot">Por mês</span>
          <strong className="num grande">{reais(r.total)}</strong>
          <span className="nota">
            {r.qtd} {r.qtd === 1 ? "conta ativa" : "contas ativas"}
          </span>
        </div>
        <div className="agora-item">
          <span className="rot">{noAtual ? "Já pago este mês" : `Já pago em ${nomeVisto}`}</span>
          <strong className="num grande pos">{reais(r.pago)}</strong>
          <div className="medidor" aria-hidden="true">
            <i style={{ width: `${r.total ? Math.min(100, (r.pago / r.total) * 100) : 0}%` }} />
          </div>
        </div>
        <div className="agora-item">
          <span className="rot">Falta pagar</span>
          <strong className="num grande">{reais(r.falta)}</strong>
          <span className="nota">{r.atrasadas ? `${r.atrasadas} com o dia já passado` : "Nada atrasado"}</span>
        </div>
        <div className="agora-item">
          <span className="rot">Por ano</span>
          <strong className="num grande">{reais(r.total * 12)}</strong>
          <span className="nota">Se nada mudar</span>
        </div>
      </div>

      <Painel largo titulo={noAtual ? "Suas contas fixas" : `Contas fixas de ${nomeVisto}`} descricao="Assinaturas e contas que se repetem todo mês. As que têm um texto para achar no banco são marcadas como pagas sozinhas; as pagas no Pix ou em dinheiro, você marca.">
        {lista.length ? (
          <ul className="dividas-lista">
            {lista.map((f) => (
              <ItemFixa key={f.id} f={f} brutos={brutos} mes={mesVisto} diaHoje={diaVisto} aoEditar={() => editar(f)} aoMudar={aoMudar} />
            ))}
          </ul>
        ) : (
          <Vazio titulo="Nenhuma conta fixa ativa">Cadastre abaixo, por exemplo a TV que você paga no Pix, ou adicione uma das cobranças achadas no banco.</Vazio>
        )}
        {canceladas.length > 0 && (
          <details className="cat-fixas" open={canceladas.some((f) => cobradaDepois(f, brutos.movimentacoes)) || undefined}>
            <summary>
              Canceladas ({canceladas.length}): {reais(canceladas.reduce((a, f) => a + f.valor, 0))} por mês que você deixou de pagar
            </summary>
            <ul className="dividas-lista">
              {canceladas.map((f) => (
                <ItemFixa key={f.id} f={f} brutos={brutos} mes={mesVisto} diaHoje={diaVisto} aoEditar={() => editar(f)} aoMudar={aoMudar} />
              ))}
            </ul>
          </details>
        )}
      </Painel>

      <div className="panel" id="fixa-form">
        <h2>{editando ? "Editar conta fixa" : "Nova conta fixa"}</h2>
        <p className="desc">Valores no formato 1.234,56.</p>
        <form className="f" onSubmit={salvar} noValidate>
          <div className="field full">
            <label htmlFor="fx-nome">Nome</label>
            <input id="fx-nome" type="text" maxLength={80} placeholder="Ex.: TV a cabo" {...campo("nome")} />
          </div>
          <div className="field">
            <label htmlFor="fx-valor">Valor por mês (R$)</label>
            <input id="fx-valor" type="text" inputMode="decimal" {...campo("valor")} />
          </div>
          <div className="field">
            <label htmlFor="fx-dia">Dia do vencimento (opcional)</label>
            <input id="fx-dia" type="number" min={1} max={31} inputMode="numeric" {...campo("dia")} />
          </div>
          <div className="field">
            <label htmlFor="fx-forma">Como paga</label>
            <select id="fx-forma" value={form.forma} onChange={(e) => setForm({ ...form, forma: e.target.value as FormaPagamento })}>
              {FORMAS.map(([k, n]) => (
                <option key={k} value={k}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="rotulo-campo">Categoria</span>
            <SeletorCategoria rotulo="Categoria da conta fixa" natureza="despesa" valor={categoriaDe(form.categoria)} aoEscolher={(c) => setForm({ ...form, categoria: c })} />
          </div>
          <div className="field full">
            <label htmlFor="fx-busca">Texto para achar no banco (opcional)</label>
            <input id="fx-busca" type="text" maxLength={60} placeholder={porFora ? "Ex.: o nome de quem recebe o Pix" : "Ex.: NETFLIX"} {...campo("busca")} />
            <span className="note">
              {porFora
                ? "Se o Pix sai da sua conta sincronizada, coloque o nome de quem recebe e ele é marcado como pago sozinho. Se não, deixe em branco e marque à mão."
                : "Um trecho da descrição como aparece no extrato ou na fatura. Com ele, a conta é marcada como paga sozinha."}
            </span>
          </div>
          {msg && <div className="erro full">{msg}</div>}
          <div className="full row">
            <button type="submit" className="primary" disabled={salvando}>
              {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Adicionar"}
            </button>
            {(editando || form.nome) && (
              <button type="button" onClick={() => (setEditando(null), setForm(vazio), setMsg(null))}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>

      <Painel titulo="Achadas no seu banco" descricao="Cobranças que se repetem e foram cobradas neste mês ou no anterior. Adicionar salva na hora; use Ajustar antes para mudar nome, valor ou dia.">
        {erroSug && <div className="erro">{erroSug}</div>}
        {sug.length ? (
          <ul className="sugestoes">
            {sug.slice(0, 12).map((s) => (
              <li key={s.chave}>
                <b>{s.nome}</b>
                <span className="num">{reais(s.valor)}</span>
                <button type="button" className="primary" disabled={adicionando === s.chave} onClick={() => adicionarSugestao(s)}>
                  {adicionando === s.chave ? "Adicionando…" : "Adicionar"}
                </button>
                <span className="note">
                  {nomeForma(s.forma)}, em {s.meses} {s.meses === 1 ? "mês" : "meses"}, última cobrança em {data(s.ultima)}
                  {s.categoria ? `, ${nomeCategoria(s.categoria)}` : ""}.{" "}
                  <button type="button" className="btn-link" onClick={() => usarSugestao(s)}>
                    Ajustar antes
                  </button>
                  {" · "}
                  <button type="button" className="btn-link" disabled={ignorando === s.chave} onClick={() => ignorar(s.chave, true)}>
                    Já cancelei
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">Nenhuma cobrança repetida nova nos últimos meses.</p>
        )}
        {brutos.fixasIgnoradas.length > 0 && (
          <details className="cat-fixas">
            <summary>Marcadas como canceladas ({brutos.fixasIgnoradas.length})</summary>
            <ul className="sugestoes">
              {brutos.fixasIgnoradas.map((c) => (
                <li key={c}>
                  <span className="cat-excluida">{c.charAt(0) + c.slice(1).toLowerCase()}</span>
                  <span />
                  <button type="button" className="btn-link" disabled={ignorando === c} onClick={() => ignorar(c, false)}>
                    Voltar a sugerir
                  </button>
                </li>
              ))}
            </ul>
            <p className="note">Se uma delas voltar a cobrar, ela não aparece aqui de novo sozinha. Confira de vez em quando.</p>
          </details>
        )}
      </Painel>
    </section>
  );
}

function ItemFixa({ f, brutos, mes, diaHoje, aoEditar, aoMudar }: { f: Fixa; brutos: Brutos; mes: string; diaHoje: number; aoEditar: () => void; aoMudar: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const s = situacao(f, brutos.movimentacoes, mes, diaHoje);
  const aindaCobrada = cobradaDepois(f, brutos.movimentacoes);

  async function rodar(fn: () => Promise<unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      await aoMudar();
    } catch (x) {
      setErro(erroDe(x));
    } finally {
      setOcupado(false);
    }
  }

  const pill =
    s.tipo === "paga" ? (
      <span className="pill ok">Paga</span>
    ) : s.tipo === "atrasada" ? (
      <span className="pill warn">Venceu dia {f.dia}</span>
    ) : s.tipo === "pausada" ? (
      aindaCobrada ? (
        <span className="pill warn">Cobrada de novo</span>
      ) : (
        <span className="pill">Cancelada</span>
      )
    ) : (
      <span className="pill">{f.dia ? `Vence dia ${f.dia}` : "A pagar"}</span>
    );

  return (
    <li className={f.ativa ? undefined : "inativa"}>
      <details className="divida">
        <summary>
          <span className="divida-nome">
            {f.nome}
            <span className="divida-sub">
              {f.dia ? `Dia ${f.dia}` : "Sem dia"} · {nomeForma(f.forma)}
            </span>
          </span>
          <span className="divida-saldo">
            <span className="num">{reais(f.valor)}</span>
            {pill}
          </span>
          <svg className="divida-seta" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </summary>
        <div className="divida-det">
          <ul>
            {f.categoria && <li>Categoria: {nomeCategoria(f.categoria)}</li>}
            {s.tipo === "paga" && s.mov && (
              <li>
                Achada no banco: paga em {data(s.mov.data)}: {tituloDe(s.mov)}
              </li>
            )}
            {s.tipo === "paga" && s.como === "manual" && <li>Marcada como paga por você neste mês</li>}
            <li>{f.busca ? `Procura no banco por "${f.busca}"` : "Não procura no banco: você marca quando pagar"}</li>
            {!f.ativa && f.cancelada_em && <li>Cancelada em {data(f.cancelada_em)}</li>}
            {aindaCobrada && <li>Cobrada de novo em {data(aindaCobrada.data)}, depois de cancelar. Confira com a empresa.</li>}
          </ul>
          <div className="row">
            {f.ativa && !(s.tipo === "paga" && s.como === "banco") && (
              <button type="button" className={s.tipo === "paga" ? "del" : "del primary"} disabled={ocupado} onClick={() => rodar(() => api.marcarFixaPaga(f.id, mes, s.tipo !== "paga"))}>
                {s.tipo === "paga" ? "Desmarcar pagamento" : "Marcar como paga"}
              </button>
            )}
            <button type="button" className="del" onClick={aoEditar}>
              Editar
            </button>
            <button
              type="button"
              className="del"
              disabled={ocupado}
              onClick={() => rodar(() => api.editarFixa(f.id, { nome: f.nome, valor: f.valor, dia: f.dia ?? null, forma: f.forma, categoria: f.categoria ?? null, busca: f.busca ?? null, ativa: !f.ativa }))}
            >
              {f.ativa ? "Cancelei" : "Reativar"}
            </button>
            <button type="button" className={"del" + (confirmar ? " confirm" : "")} disabled={ocupado} onClick={() => (confirmar ? rodar(() => api.excluirFixa(f.id)) : setConfirmar(true))}>
              {confirmar ? "Confirmar exclusão" : "Excluir"}
            </button>
          </div>
          {erro && <span className="cat-erro">{erro}</span>}
        </div>
      </details>
    </li>
  );
}
