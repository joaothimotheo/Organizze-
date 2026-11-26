import { useState, type FormEvent, type ReactNode } from "react";
import { api, type Brutos, type Divida, type NovaDivida } from "../api";
import { GraficoParcelas } from "../componentes/Graficos";
import { PlanoQuitacao } from "../componentes/Plano";
import { Indicador, Painel, Vazio } from "../componentes/Indicador";
import JanelaTipoDivida from "../componentes/JanelaTipoDivida";
import { data, hojeISO, lerValor, MESES, MESES_CURTOS, reais } from "../formato";
import {
  depoisDoSaldoInformado,
  informada,
  juntarDividas,
  mesDaProjecao,
  ordemSugerida,
  parcelasCartao,
  parcelasAtivas,
  parceladasAtivas,
  parcelasPorFatura,
  pct,
  projetar,
  resumo,
  simularAdiantar,
  sugestoesPagamento,
  tipoDaDivida,
  TIPOS_PADRAO,
  ultimoSaldo,
  ultimoSaldoInformado,
  type DividaVista,
  type Parcelamento,
  type SugestaoPagamento,
} from "../dividas";

/** Último item da lista (sem `Array.at`, que falta em navegadores antigos de celular). */
const ultimo = <T,>(l: T[]): T | undefined => l[l.length - 1];

/** Peso das parcelas no salário a partir do qual a barra fica âmbar. */
const PESO_ALTO = 0.3;
/** Controle "E se eu adiantar?": de R$ 0 a R$ 5.000, de 100 em 100. */
const ADIANTAR_MAX = 5000;
const ADIANTAR_PASSO = 100;

/** "2026-12" → "dez/2026". */
const mesAnoLongo = (comp: string) => `${MESES_CURTOS[Number(comp.slice(5, 7)) - 1]}/${comp.slice(0, 4)}`;
/** Data da parcela: só o mês nas compras do cartão ("dez/2026"), o dia nas outras ("10/12/2026"). */
const dataParcela = (d: string) => (d.length === 7 ? mesAnoLongo(d) : data(d));
/** "a, b e c". */
const juntarNomes = (l: string[]) => (l.length <= 1 ? (l[0] ?? "") : `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}`);
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Tipos que o formulário oferece: os padrões (menos "Com pessoas", que vem da tela Pessoas) e os criados. */
const opcoesTipo = (criados: { id: string; nome: string }[]) => [...TIPOS_PADRAO.filter((t) => t.id !== "pessoas"), ...criados];

type Form = Record<keyof NovaDivida, string>;
const formVazio = (): Form => ({
  nome: "",
  credor: "",
  tipo: "outras",
  valor_atual: "",
  data_referencia: hojeISO(),
  valor_original: "",
  vencimento_original: "",
  parcelas_restantes: "",
  parcelas_total: "",
  valor_parcela: "",
  proximo_vencimento: "",
  taxa_mensal: "",
  obs: "",
});

function paraForm(d: Divida): Form {
  const s = ultimoSaldo(d);
  const t = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    nome: d.nome ?? d.credor,
    credor: d.credor === d.nome ? "" : d.credor,
    tipo: d.tipo || "outras",
    valor_atual: t(s?.saldo_devedor),
    data_referencia: s?.data ?? hojeISO(),
    valor_original: t(d.valor_contratado),
    vencimento_original: t(d.vencimento_original),
    parcelas_restantes: t(d.parcelas_restantes),
    parcelas_total: t(d.parcelas_total),
    valor_parcela: t(d.parcela_valor),
    proximo_vencimento: t(d.proximo_vencimento),
    taxa_mensal: t(d.taxa_mensal),
    obs: t(d.obs),
  };
}

/** Segue o mês do topo: num mês à frente mostra a projeção; no atual ou num passado, a tela de hoje. */
export default function Dividas({ brutos, aoMudar, ano, mes }: { brutos: Brutos; aoMudar: () => Promise<void>; ano: number; mes: number | null }) {
  const hoje = hojeISO();
  const alvo = mesDaProjecao(ano, mes, hoje);
  if (alvo) return <ProjecaoDividas brutos={brutos} mes={alvo} hoje={hoje} />;
  const passado = `${ano}-${String(mes ?? 12).padStart(2, "0")}` < hoje.slice(0, 7);
  return <DividasHoje brutos={brutos} aoMudar={aoMudar} aviso={passado ? "Para ver o futuro, escolha um mês à frente." : null} />;
}

/** "2027-03" → "março" e "março/2027". */
const nomeMes = (comp: string) => MESES[Number(comp.slice(5, 7)) - 1];

/** Um bloco de dívidas de um tipo: o nome, o total até o fim e as linhas. */
function GrupoTipo({ nome, ds, linha, rodape }: { nome: string; ds: DividaVista[]; linha: (d: DividaVista) => ReactNode; rodape?: ReactNode }) {
  return (
    <section className="dv-grupo" aria-label={nome}>
      <header>
        <h3>{nome}</h3>
        <span className="num">{ds.length ? reais(ds.reduce((s, d) => s + d.ateOFim, 0)) : "nenhuma ainda"}</span>
      </header>
      {ds.map(linha)}
      {rodape}
    </section>
  );
}

function ProjecaoDividas({ brutos, mes, hoje }: { brutos: Brutos; mes: string; hoje: string }) {
  const [aberta, setAberta] = useState<string | null>(null);
  const p = projetar(brutos, mes, hoje);
  const nome = nomeMes(mes);
  const vistas = p.itens.map((i) => i.vista);
  const tipos = [...TIPOS_PADRAO, ...(brutos.dividasTipos ?? [])].filter((t) => vistas.some((v) => v.tipo === t.id));
  // Parcelas do mês escolhido em diante; quem ficou sem nenhuma já terminou.
  const parceladas = parceladasAtivas(brutos)
    .map((x) => ({ ...x, meses: x.meses.filter((m) => m >= mes) }))
    .filter((x) => x.meses.length > 0);
  const faturas = parcelasPorFatura(brutos).filter(([m]) => m >= mes);
  // A última parcela no próprio mês escolhido ainda entra em "Parcelas de <mês>"; as demais já estavam quitadas antes.
  const ultimaNoMes = p.quitadas.filter((q) => q.quitadaEm === mes);
  const antes = p.quitadas.filter((q) => q.quitadaEm !== mes);
  return (
    <>
      <p className="aviso-vencido" role="note">
        Projeção: supõe parcelas pagas em dia.
      </p>
      <section className="kpis dv-kpis" aria-label={`Projeção das dívidas em ${nome}/${mes.slice(0, 4)}`}>
        <Indicador rotulo="Você ainda vai dever" valor={p.deve} detalhe={`hoje: ${reais(p.deveHoje)}`} />
        <Indicador
          rotulo={`Parcelas de ${nome}`}
          valor={p.parcelasDoMes}
          detalhe={p.peso === null ? `em ${nome}/${mes.slice(0, 4)}` : `${Math.round(p.peso * 100)}% do salário`}
        />
      </section>
      {ultimaNoMes.length > 0 && (
        <p className="note">
          Última parcela em {nome}/{mes.slice(0, 4)}: {ultimaNoMes.map((q) => `${q.divida.nome} (${reais(q.divida.parcela ?? 0)})`).join(", ")}.
        </p>
      )}
      {antes.length > 0 && (
        <p className="note">Quitadas até lá: {antes.map((q) => `${q.divida.nome} (${mesAnoLongo(q.quitadaEm)})`).join(", ")}.</p>
      )}
      <section className="dv-corpo">
        <div className="dv-lista">
          {tipos.length ? (
            tipos.map((t) => (
              <GrupoTipo
                key={t.id}
                nome={t.nome}
                ds={vistas.filter((v) => v.tipo === t.id)}
                linha={(d) => (
                  <LinhaDivida key={d.id} d={d} hoje={`${mes}-01`} aberta={aberta === d.id} aoAbrir={() => setAberta(aberta === d.id ? null : d.id)} brutos={brutos} somenteLeitura />
                )}
              />
            ))
          ) : (
            <Vazio titulo={`Nenhuma dívida em aberto em ${nome}`}>Tudo o que está cadastrado terá sido quitado até lá.</Vazio>
          )}
        </div>
      </section>
      <section className="grid">
        <Painel largo titulo="Quando fico livre das dívidas" descricao="Uma estimativa com as parcelas, as dívidas sem parcelas, o que você deve a pessoas e a sua primeira meta.">
          <p className="note">Conta a partir de {nome}/{mes.slice(0, 4)}, incluindo as parcelas dele.</p>
          <PlanoQuitacao brutos={brutos} parceladas={parceladas} inicio={mes} />
        </Painel>
        <Painel titulo="Parcelas já comprometidas" descricao="Quanto de cada fatura futura já está ocupado por parcelas.">
          <GraficoParcelas meses={faturas} />
        </Painel>
      </section>
    </>
  );
}

function DividasHoje({ brutos, aoMudar, aviso }: { brutos: Brutos; aoMudar: () => Promise<void>; aviso: string | null }) {
  const [form, setForm] = useState<Form>(formVazio);
  const [editando, setEditando] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState<string | null>(null);
  const [aba, setAba] = useState<string>("todas");
  const [aberta, setAberta] = useState<string | null>(null);
  const [novoTipo, setNovoTipo] = useState(false);
  const [adiantar, setAdiantar] = useState(0);

  const hoje = hojeISO();
  const criados = brutos.dividasTipos ?? [];
  const tipos = [...TIPOS_PADRAO, ...criados];
  const vistas = juntarDividas(brutos, hoje);
  const topo = resumo(vistas, brutos, hoje);
  const sugestoes = sugestoesPagamento(brutos, hoje);
  const ordem = ordemSugerida(vistas);
  const alvo = simularAdiantar(vistas, ADIANTAR_PASSO)?.alvo ?? null;
  const sim = simularAdiantar(vistas, adiantar);
  const semData = vistas.filter((v) => v.parcela === null).map((v) => v.nome);

  // Parcelas por mês (gráfico e plano), como antes: compras do cartão e dívidas parceladas cadastradas.
  const pc = parcelasCartao(brutos);
  const ativas = parcelasAtivas(brutos, pc);
  const terminaram = pc.filter((p) => p.restantes === 0);
  const meses = parcelasPorFatura(brutos);

  const faturas = brutos.documentos.filter((d) => d.tipo === "fatura_cartao").sort((a, b) => (a.competencia ?? "").localeCompare(b.competencia ?? ""));
  const ultFatura = ultimo(faturas);
  // A conferência com o PDF só faz sentido se ele for da fatura mais recente com parcelas.
  const refCartao = brutos.movimentacoes.reduce((m, x) => (x.parcela && x.competencia && x.competencia > m ? x.competencia : m), "");
  const conferir = ultFatura?.parcelas_a_vencer != null && ultFatura.competencia === refCartao;
  // Anuidade: categoria antiga de tarifas ou, no modelo novo de grupos, "ANUIDADE" na descrição (ou no nome do banco).
  const ehAnuidade = (p: Parcelamento) => p.categoria === "tarifas_bancarias" || /ANUIDADE/i.test(`${p.descricao} ${p.noBanco ?? ""}`);
  const somaCompras = pc.filter((p) => !ehAnuidade(p)).reduce((s, p) => s + p.saldo, 0);
  const somaAnuidade = pc.filter(ehAnuidade).reduce((s, p) => s + p.saldo, 0);

  const mostrar = aba === "todas" ? tipos : tipos.filter((t) => t.id === aba);
  const tipoCriadoAberto = criados.find((t) => t.id === aba) ?? null;

  const campo = (k: keyof Form) => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value }) });
  const num = (v: string) => lerValor(v);
  const txt = (v: string) => (v.trim() === "" ? null : v.trim());

  async function salvar(ev: FormEvent) {
    ev.preventDefault();
    const valor = num(form.valor_atual);
    if (!form.nome.trim() || valor === null || !(valor >= 0) || !form.data_referencia) {
      setMsg("Preencha nome, valor devido e a data do valor.");
      return;
    }
    const parcelas = num(form.parcelas_restantes);
    const vParcela = num(form.valor_parcela);
    const totalParc = num(form.parcelas_total);
    if (!!parcelas !== !!vParcela) {
      setMsg("Para dívida parcelada, informe as parcelas restantes e o valor da parcela.");
      return;
    }
    if (totalParc && parcelas && totalParc < parcelas) {
      setMsg("O total de parcelas não pode ser menor que as parcelas restantes.");
      return;
    }
    const d: NovaDivida = {
      nome: form.nome.trim(),
      credor: txt(form.credor),
      tipo: txt(form.tipo),
      valor_atual: valor,
      data_referencia: form.data_referencia,
      valor_original: num(form.valor_original),
      vencimento_original: txt(form.vencimento_original),
      parcelas_restantes: parcelas,
      parcelas_total: parcelas ? totalParc : null,
      valor_parcela: vParcela,
      proximo_vencimento: txt(form.proximo_vencimento),
      taxa_mensal: num(form.taxa_mensal),
      obs: txt(form.obs),
    };
    setSalvando(true);
    setMsg("Salvando…");
    try {
      if (editando) await api.editarDivida(editando, d);
      else await api.criarDivida(d);
      await aoMudar();
      setMsg(editando ? "Dívida atualizada." : "Dívida salva.");
      setForm(formVazio());
      setEditando(null);
    } catch (e) {
      setMsg(`Não consegui salvar: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: string) {
    if (confirmarExclusao !== id) {
      setConfirmarExclusao(id);
      return;
    }
    try {
      await api.excluirDivida(id);
      setConfirmarExclusao(null);
      if (editando === id) {
        setEditando(null);
        setForm(formVazio());
      }
      await aoMudar();
    } catch (e) {
      setMsg(`Não consegui remover: ${e instanceof Error ? e.message : e}`);
    }
  }

  function editar(d: Divida) {
    setEditando(d.id);
    setForm(paraForm(d));
    setMsg(null);
    irParaFormulario();
  }

  function irParaFormulario() {
    document.getElementById("f-div")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function criarTipo(nome: string) {
    const t = await api.criarTipoDivida(nome);
    await aoMudar();
    setNovoTipo(false);
    setAba(t.id);
  }

  // Opções do select: se a dívida tem um tipo antigo (ipva, financiamento…), ele fica no lugar do tipo em que ela aparece.
  const grupoDoForm = tipoDaDivida({ tipo: form.tipo } as Divida, criados);
  const opcoes = opcoesTipo(criados).map((t) => ({ valor: t.id === grupoDoForm ? form.tipo : t.id, nome: t.nome }));

  return (
    <>
      {aviso && (
        <p className="aviso-vencido" role="note">
          {aviso}
        </p>
      )}
      {sugestoes.length > 0 && (
        <section className="dv-avisos" aria-label="Pagamentos achados no banco">
          {sugestoes.map((s) => (
            <AvisoPagamento key={`${s.lancamento.id}|${s.divida.id}`} s={s} aoMudar={aoMudar} />
          ))}
        </section>
      )}

      <section className="kpis dv-kpis" aria-label="Resumo das dívidas">
        <Indicador rotulo="Você deve" valor={vistas.length ? topo.deve : null} vazio="Nada" detalhe={vistas.length ? `em ${plural(vistas.length, "dívida", "dívidas")}` : "Nenhuma dívida em aberto"} />
        <Indicador rotulo="Juros que faltam" valor={vistas.length ? topo.juros : null} vazio="—" detalhe="se pagar só as parcelas" />
        <div className="kpi">
          <div className="lbl">Peso no mês</div>
          {topo.peso === null ? (
            <>
              <div className="val nodata">—</div>
              <div className="sub">Cadastre um holerite ou classifique o salário para ver o peso.</div>
            </>
          ) : (
            <>
              <div className="val">
                {Math.round(topo.peso * 100)}% <span className="dv-kpi-de">do salário</span>
              </div>
              <div className="medidor" aria-hidden="true">
                <i className={topo.peso > PESO_ALTO ? "alto" : undefined} style={{ width: `${Math.min(100, topo.peso * 100)}%` }} />
              </div>
              <div className="sub">{reais(topo.parcelasDoMes)} em parcelas por mês</div>
            </>
          )}
        </div>
        <div className="kpi">
          <div className="lbl">Livre das parcelas</div>
          <div className={topo.livre ? "val" : "val nodata"}>{topo.livre ? mesAnoLongo(topo.livre) : "Sem parcelas"}</div>
          <div className="sub">{semData.length === 0 ? "Todas com data para acabar" : semData.length <= 3 ? `${juntarNomes(semData)} sem data` : `${semData.length} dívidas sem data`}</div>
        </div>
      </section>

      <div className="mv-abas dv-abas" role="group" aria-label="Tipo de dívida">
        <button type="button" aria-pressed={aba === "todas"} onClick={() => setAba("todas")}>
          Todas
        </button>
        {tipos.map((t) => (
          <button key={t.id} type="button" aria-pressed={aba === t.id} onClick={() => setAba(t.id)}>
            {t.nome}
          </button>
        ))}
        <button type="button" className="dv-novo-tipo" onClick={() => setNovoTipo(true)}>
          + Novo tipo
        </button>
      </div>
      {tipoCriadoAberto && (
        <ApagarTipo key={tipoCriadoAberto.id} tipo={tipoCriadoAberto} n={vistas.filter((v) => v.tipo === tipoCriadoAberto.id).length} aoApagar={async () => (await aoMudar(), setAba("todas"))} />
      )}

      <section className="grid dv-corpo">
        <div className="dv-lista">
          {mostrar.map((t) => (
            <GrupoTipo
              key={t.id}
              nome={t.nome}
              ds={vistas.filter((v) => v.tipo === t.id)}
              linha={(d) => (
                <LinhaDivida
                  key={d.id}
                  d={d}
                  hoje={hoje}
                  aberta={aberta === d.id}
                  aoAbrir={() => setAberta(aberta === d.id ? null : d.id)}
                  brutos={brutos}
                  parcelamento={d.origem === "cartao" ? pc.find((p) => `cartao:${p.chave}` === d.id) : undefined}
                  confirmando={confirmarExclusao === d.id}
                  aoEditar={editar}
                  aoExcluir={excluir}
                  aoMudar={aoMudar}
                />
              )}
              rodape={
                <>
                  {t.id === "cartao" && terminaram.length > 0 && (
                    <p className="note">Terminaram na última fatura: {terminaram.map((p) => p.descricao + (p.total && p.total > 1 ? ` (${p.total}x)` : "")).join(", ")}.</p>
                  )}
                  {t.id === "cartao" && conferir && ultFatura && (
                    <p className="note">
                      Conferência: a fatura com vencimento em {data(ultFatura.vencimento)} informa {reais(ultFatura.parcelas_a_vencer ?? 0)} em compras parceladas a vencer; a soma das
                      compras acima dá {reais(somaCompras)}
                      {somaAnuidade ? `, mais ${reais(somaAnuidade)} da anuidade parcelada.` : "."}
                    </p>
                  )}
                </>
              }
            />
          ))}
        </div>
        <div className="dv-lado">
          <Painel titulo="E se eu adiantar?" descricao={alvo ? `O valor vai para a dívida com juro mais caro: ${alvo.nome}.` : "O valor vai para a dívida com juro mais caro."}>
            {alvo ? (
              <>
                <label className="dv-adiantar" htmlFor="dv-adiantar">
                  Pagar a mais neste mês <b className="num">{reais(adiantar)}</b>
                </label>
                <input type="range" id="dv-adiantar" min={0} max={ADIANTAR_MAX} step={ADIANTAR_PASSO} value={adiantar} onChange={(e) => setAdiantar(Number(e.target.value))} />
                {sim?.alvo ? (
                  sim.quita ? (
                    <>
                      <p className="dv-ans">
                        Quita {sim.alvo.nome} e economiza <em className="num">{reais(sim.economia)}</em> de juros.
                      </p>
                      {sim.sobra > 0 && (
                        <p className="note">
                          Sobram {reais(sim.sobra)}
                          {sim.proxima ? ` para a próxima da lista (${sim.proxima.nome}).` : "."}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="dv-ans">
                        Economiza <em className="num">{reais(sim.economia)}</em> de juros
                        {sim.mesesAMenos > 0 ? (
                          <>
                            {" "}
                            e {sim.alvo.nome} acaba <em>{plural(sim.mesesAMenos, "mês", "meses")} antes</em>.
                          </>
                        ) : (
                          "."
                        )}
                      </p>
                      {sim.mesesAMenos > 0 && (
                        <p className="note">
                          Faltariam {sim.alvo.restantes - sim.mesesAMenos} parcelas em vez de {sim.alvo.restantes}.
                        </p>
                      )}
                    </>
                  )
                ) : (
                  <p className="note">Arraste para ver quanto você economiza.</p>
                )}
              </>
            ) : (
              <Vazio titulo="Nenhuma dívida com juros conhecidos">Informe a taxa ao mês de uma dívida parcelada no formulário para simular.</Vazio>
            )}
          </Painel>
          <Painel titulo="Ordem sugerida para quitar" descricao="Se sobrar dinheiro no mês, adiante nesta ordem.">
            {ordem.length ? (
              <ol className="dv-ordem">
                {ordem.map((o) => (
                  <li key={o.divida.id}>
                    <span>
                      <b>{o.divida.nome}</b>: {o.motivo}.
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <Vazio titulo="Nenhuma dívida em aberto">Quando houver dívidas, a ordem para quitar aparece aqui.</Vazio>
            )}
            <button type="button" onClick={irParaFormulario}>
              Adicionar dívida
            </button>
          </Painel>
        </div>
      </section>

      <section className="grid">
        <Painel largo titulo="Quando fico livre das dívidas" descricao="Uma estimativa com as parcelas, as dívidas sem parcelas, o que você deve a pessoas e a sua primeira meta.">
          <PlanoQuitacao brutos={brutos} parceladas={ativas.map((p) => ({ nome: p.descricao, valor: p.valor, meses: p.meses }))} />
        </Painel>
        <Painel titulo="Parcelas já comprometidas" descricao="Quanto de cada fatura futura já está ocupado por parcelas.">
          <GraficoParcelas meses={meses} />
        </Painel>
        <Painel titulo={editando ? "Editar dívida" : "Adicionar dívida"} descricao="IPVA, empréstimo, acordo ou qualquer conta em atraso. Fica marcada como informada por você, não como documento.">
          <form className="f" id="f-div" onSubmit={salvar} noValidate>
            <div className="field full">
              <label htmlFor="d-nome">Nome</label>
              <input type="text" id="d-nome" maxLength={80} placeholder="Ex.: IPVA 2025" {...campo("nome")} />
            </div>
            <div className="field">
              <label htmlFor="d-tipo">Tipo</label>
              <select id="d-tipo" {...campo("tipo")}>
                {opcoes.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="d-credor">Credor</label>
              <input type="text" id="d-credor" maxLength={80} placeholder="Ex.: SEFAZ-PR" {...campo("credor")} />
            </div>
            <div className="field">
              <label htmlFor="d-valor">Valor devido hoje (R$)</label>
              <input type="text" inputMode="decimal" id="d-valor" placeholder="0,00" {...campo("valor_atual")} />
            </div>
            <div className="field">
              <label htmlFor="d-data">Valor válido em</label>
              <input type="date" id="d-data" {...campo("data_referencia")} />
            </div>
            <div className="field">
              <label htmlFor="d-original">Valor original (R$)</label>
              <input type="text" inputMode="decimal" id="d-original" {...campo("valor_original")} />
            </div>
            <div className="field">
              <label htmlFor="d-venc">Vencimento original</label>
              <input type="date" id="d-venc" {...campo("vencimento_original")} />
            </div>
            <div className="field">
              <label htmlFor="d-parc">Parcelas restantes</label>
              <input type="text" inputMode="numeric" id="d-parc" placeholder="Vazio se for à vista" {...campo("parcelas_restantes")} />
            </div>
            <div className="field">
              <label htmlFor="d-tparc">Total de parcelas</label>
              <input type="text" inputMode="numeric" id="d-tparc" placeholder="Ex.: 19 (opcional)" {...campo("parcelas_total")} />
            </div>
            <div className="field">
              <label htmlFor="d-vparc">Valor da parcela (R$)</label>
              <input type="text" inputMode="decimal" id="d-vparc" {...campo("valor_parcela")} />
            </div>
            <div className="field">
              <label htmlFor="d-prox">Próximo vencimento</label>
              <input type="date" id="d-prox" {...campo("proximo_vencimento")} />
            </div>
            <div className="field">
              <label htmlFor="d-obs">Observação</label>
              <input type="text" id="d-obs" maxLength={200} placeholder="Ex.: placa, multa, acordo" {...campo("obs")} />
            </div>
            <div className="full row">
              <button type="submit" className="primary" disabled={salvando}>
                {editando ? "Salvar alterações" : "Salvar dívida"}
              </button>
              {editando && (
                <button
                  type="button"
                  onClick={() => {
                    setEditando(null);
                    setForm(formVazio());
                    setMsg(null);
                  }}
                >
                  Cancelar
                </button>
              )}
              {msg && <span className="note">{msg}</span>}
            </div>
          </form>
        </Painel>
      </section>

      {novoTipo && <JanelaTipoDivida existentes={tipos.map((t) => t.nome)} aoSalvar={criarTipo} aoFechar={() => setNovoTipo(false)} />}
    </>
  );
}

/** Texto da pergunta do aviso: "a parcela 4 de 12", "a parcela 4" ou "uma parcela". */
const qualParcela = (n: number | null, t: number | null) => (n !== null && t !== null ? `a parcela ${n} de ${t}` : n !== null ? `a parcela ${n}` : "uma parcela");

/** "Achei um pagamento no banco": "Sim, é" liga o lançamento à dívida; "Não é" grava a recusa. */
function AvisoPagamento({ s, aoMudar }: { s: SugestaoPagamento; aoMudar: () => Promise<void> }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const m = s.lancamento;

  async function responder(sim: boolean) {
    setSalvando(true);
    setErro(null);
    try {
      if (sim) await api.editarLancamento(m.id, { vinculo: { tipo: "divida", id: s.divida.id } });
      else await api.recusarSugestao(s.divida.id, m.id);
      await aoMudar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
      setSalvando(false);
    }
  }

  return (
    <div className="dv-aviso">
      <p>
        <b>Achei um pagamento no banco.</b>
        <br />
        {m.nome?.trim() || m.descricao} · {data(m.data)} · {reais(Math.abs(m.valor))}. É {qualParcela(s.n, s.t)} de <b>{s.divida.nome}</b>?
      </p>
      <div className="row">
        <button type="button" disabled={salvando} onClick={() => responder(false)}>
          Não é
        </button>
        <button type="button" className="primary" disabled={salvando} onClick={() => responder(true)}>
          {salvando ? "Salvando…" : "Sim, é"}
        </button>
      </div>
      {erro && <p className="campo-erro dv-aviso-erro">Não consegui salvar: {erro}</p>}
    </div>
  );
}

/** "Apagar tipo" de um tipo criado, com a confirmação na própria página. */
function ApagarTipo({ tipo, n, aoApagar }: { tipo: { id: string; nome: string }; n: number; aoApagar: () => Promise<void> }) {
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function apagar() {
    setSalvando(true);
    setErro(null);
    try {
      await api.apagarTipoDivida(tipo.id);
      await aoApagar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
      setSalvando(false);
    }
  }

  if (!confirmando)
    return (
      <div className="dv-tipo-acoes">
        <button type="button" className="btn-link perigo" onClick={() => setConfirmando(true)}>
          Apagar tipo
        </button>
      </div>
    );
  return (
    <div className="jn-confirmar dv-tipo-confirmar" role="alertdialog" aria-label={`Apagar o tipo ${tipo.nome}?`}>
      <b>
        {n === 0
          ? "Nenhuma dívida usa este tipo. Apagar?"
          : n === 1
            ? "A dívida deste tipo vai para Outras dívidas. Apagar?"
            : `As ${n} dívidas deste tipo vão para Outras dívidas. Apagar?`}
      </b>
      <span>
        <button type="button" disabled={salvando} onClick={() => setConfirmando(false)}>
          Cancelar
        </button>
        <button type="button" className="primary" disabled={salvando} onClick={apagar}>
          {salvando ? "Apagando…" : "Apagar"}
        </button>
      </span>
      {erro && <span className="campo-erro">Não consegui apagar: {erro}</span>}
    </div>
  );
}

const ETIQUETA: Record<NonNullable<DividaVista["etiqueta"]>, string> = { atraso: "warn", juros_altos: "bad", sem_juros: "ok" };

function textoEtiqueta(d: DividaVista) {
  if (d.etiqueta === "atraso") return "Em atraso";
  if (d.etiqueta === "juros_altos") return `Juros altos · ${pct(d.taxa ?? 0)} ao mês`;
  if (d.etiqueta === "sem_juros") return "Sem juros";
  return null;
}

/** Uma dívida: linha que abre com quanto falta, juros e os pagamentos. */
function LinhaDivida({
  d,
  hoje,
  aberta,
  aoAbrir,
  brutos,
  parcelamento,
  confirmando,
  aoEditar,
  aoExcluir,
  aoMudar,
  somenteLeitura = false,
}: {
  d: DividaVista;
  hoje: string;
  aberta: boolean;
  aoAbrir: () => void;
  brutos: Brutos;
  parcelamento?: Parcelamento;
  confirmando?: boolean;
  aoEditar?: (d: Divida) => void;
  aoExcluir?: (id: string) => void;
  aoMudar?: () => Promise<void>;
  /** Na projeção: sem editar, excluir nem ligar pagamento; o detalhe mostra só os pagamentos. `hoje` é o dia 1 do mês escolhido. */
  somenteLeitura?: boolean;
}) {
  const etiqueta = textoEtiqueta(d);
  const original = d.origem === "cadastrada" ? brutos.dividas.find((x) => x.id === d.id) : undefined;
  const idDet = `dv-det-${d.id}`;

  const esquerda =
    d.parcela !== null
      ? d.pagas !== null && d.total !== null
        ? `${d.pagas} de ${d.total} pagas · ${reais(d.parcela)} por mês`
        : `${plural(d.restantes, "parcela", "parcelas")} de ${reais(d.parcela)} faltando`
      : "Valor em aberto";
  const vencida = !somenteLeitura && d.parcela === null && original?.vencimento_original && original.vencimento_original < hoje ? original.vencimento_original : null;
  const mesEscolhido = hoje.slice(0, 7);
  const direita =
    d.proxima && somenteLeitura
      ? d.proxima.data.slice(0, 7) === mesEscolhido
        ? `Parcela de ${nomeMes(mesEscolhido)}: ${reais(d.proxima.valor)}`
        : `Próxima: ${reais(d.proxima.valor)} em ${dataParcela(d.proxima.data)}`
      : d.proxima
    ? `${d.proxima.data.length === 10 && d.proxima.data < hoje ? "Venceu" : "Próxima"}: ${reais(d.proxima.valor)} em ${dataParcela(d.proxima.data)}`
    : d.parcela === null
      ? vencida
        ? `Venceu em ${data(vencida)}`
        : d.atraso
          ? "Sem data. Pagar o quanto antes"
          : "Sem parcelas combinadas"
      : "";
  const saldoInformado = original ? ultimoSaldoInformado(original) : null;

  // Vínculo feito antes desta versão: o lançamento aponta para a dívida, mas não baixou parcela
  // (os de até o último saldo informado já estão descontados dele e não precisam baixar).
  const pagos = new Set((original?.pagamentos ?? []).map((p) => p.lancamento_id));
  const ligadoAntes =
    !somenteLeitura &&
    !!original && brutos.movimentacoes.some((m) => m.vinculo?.tipo === "divida" && m.vinculo.id === d.id && !pagos.has(m.id) && depoisDoSaldoInformado(original, m.data));

  return (
    <div className="dv-divida">
      <button type="button" className="dv-divida-btn" aria-expanded={aberta} aria-controls={idDet} onClick={aoAbrir}>
        <span className="dv-l1">
          <span className="dv-nome">
            <b>{d.nome}</b>
            {etiqueta && <span className={`pill ${ETIQUETA[d.etiqueta!]}`}>{etiqueta}</span>}
          </span>
          <b className="num dv-valor">{reais(d.ateOFim)}</b>
        </span>
        {d.pagas !== null && d.total ? (
          <span className="medidor" aria-hidden="true">
            <i style={{ width: `${(d.pagas / d.total) * 100}%` }} />
          </span>
        ) : null}
        <span className="dv-l2">
          <span>{esquerda}</span>
          {direita && <span>{direita}</span>}
        </span>
      </button>
      {aberta && (
        <div className="dv-det" id={idDet}>
          {!somenteLeitura && (
            <>
          <div className="dv-minis">
            <div className="dv-mini">
              <small>Para quitar hoje</small>
              <b className="num">{reais(d.quitarHoje)}</b>
            </div>
            <div className="dv-mini">
              <small>Pagando até o fim</small>
              <b className="num">{reais(d.ateOFim)}</b>
            </div>
            <div className="dv-mini">
              <small>Juros que faltam</small>
              <b className={"num" + (d.juros > 0 ? " neg" : "")}>{d.atraso && d.juros === 0 ? "cresce com a multa" : reais(d.juros)}</b>
            </div>
          </div>
          {d.fim && <p className="note">Termina em {mesAnoLongo(d.fim)}.</p>}
          {saldoInformado && <p className="note">Saldo informado em {data(saldoInformado.data)}.</p>}
          {original && ((original.nome && original.credor !== original.nome) || original.obs) && (
            <p className="note">{[original.nome && original.credor !== original.nome ? `Credor: ${original.credor}` : "", original.obs ?? ""].filter(Boolean).join(" · ")}</p>
          )}
            </>
          )}
          <div className="dv-sec">Pagamentos</div>
          {d.pagamentos.length ? (
            <ul className="dv-pagamentos">
              {d.pagamentos.map((p, i) => (
                <li key={`${p.data}-${i}`}>
                  <span>
                    <b>{p.texto}</b>
                    <small>{data(p.data)}</small>
                  </span>
                  <span className="num">{reais(p.valor)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">Nenhum pagamento ainda.</p>
          )}
          {ligadoAntes && <p className="note">Ligou um lançamento antes desta versão? Desligue e ligue de novo em Movimentos para contar a parcela.</p>}
          {!somenteLeitura && original && informada(original) && aoEditar && aoExcluir && (
            <div className="row">
              <button type="button" className="del" onClick={() => aoEditar(original)}>
                Editar
              </button>
              <button type="button" className={"del" + (confirmando ? " confirm" : "")} onClick={() => aoExcluir(original.id)}>
                {confirmando ? "Confirmar remoção" : "Remover"}
              </button>
            </div>
          )}
          {!somenteLeitura && parcelamento && aoMudar && (
            <>
              {parcelamento.noBanco && <p className="note">No banco: {parcelamento.noBanco}</p>}
              <NomeParcelamento p={parcelamento} aoMudar={aoMudar} />
            </>
          )}
          {!somenteLeitura && d.origem === "pessoa" && (
            <a className="btn-link dv-pessoas" href="#pessoas">
              Ver e registrar pagamentos em Pessoas
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** Botão para dar nome à compra parcelada ("CAVALERA BARBER S" → "Tênis"). Vale para todas as parcelas. */
function NomeParcelamento({ p, aoMudar }: { p: Parcelamento; aoMudar: () => Promise<void> }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(nome: string) {
    setSalvando(true);
    setErro(null);
    try {
      await api.nomearVarios(p.ids, nome.trim());
      setEditando(false);
      await aoMudar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
    } finally {
      setSalvando(false);
    }
  }

  if (editando)
    return (
      <form
        className="lanc-form-nome"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          salvar(texto);
        }}
      >
        <input
          type="text"
          maxLength={120}
          autoFocus
          placeholder="O que foi comprado? Ex.: Tênis"
          aria-label={`Nome para ${p.noBanco ?? p.descricao}`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditando(false)}
        />
        <button type="submit" className="primary" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        {p.noBanco && (
          <button type="button" disabled={salvando} onClick={() => salvar("")}>
            Tirar nome
          </button>
        )}
        <button type="button" className="btn-link" onClick={() => setEditando(false)}>
          Cancelar
        </button>
        {erro && <span className="cat-erro">{erro}</span>}
      </form>
    );
  return (
    <button type="button" className="del parc-renomear" onClick={() => (setTexto(p.noBanco ? p.descricao : ""), setErro(null), setEditando(true))}>
      {p.noBanco ? "Mudar o nome" : "Dar nome à compra"}
    </button>
  );
}
