import { useCallback, useEffect, useState } from "react";
import { api, esperandoAcordar, quandoPerderSessao, SemSessao, type MetodosLogin, type Brutos, type Fonte, type FonteDados, type Indicadores, type Movimentacao, type VisaoGeral as Visao } from "./api";
import { desativarEste } from "./avisos";
import { addMes, data, definirOcultar, hojeISO, MESES, numero } from "./formato";
import { compDe } from "./gastos";
import { ehEntrada } from "./grupos";
import { rotaMovimentos } from "./movimentos";
import { contarPendentes, destinoPendentes, enderecoCanonico, periodoDoLancamento, telaDoEndereco } from "./navegacao";
import Analises from "./paginas/Analises";
import Categorias from "./paginas/Categorias";
import Dividas from "./paginas/Dividas";
import Fechamento from "./paginas/Fechamento";
import Enviar, { nomeConta } from "./paginas/Enviar";
import Gastos from "./paginas/Gastos";
import Login from "./paginas/Login";
import Migracao from "./paginas/Migracao";
import Fixas from "./paginas/Fixas";
import Mais from "./paginas/Mais";
import Movimentos from "./paginas/Movimentos";
import Objetivos from "./paginas/Objetivos";
import Pessoas from "./paginas/Pessoas";
import Salarios from "./paginas/Salarios";
import Simples from "./paginas/Simples";
import BarraTopo from "./componentes/BarraTopo";
import Lancar from "./componentes/Lancar";
import { BarraDeBaixo, MenuLateral } from "./componentes/Menu";
import Sincronizacao from "./componentes/Sincronizacao";
import VisaoGeral from "./paginas/VisaoGeral";
import VisaoGeralAntiga from "./paginas/VisaoGeralAntiga";
import { aoMudarInstalacao, ehIos, instalado, instalar, limparCacheLocal, podeInstalar } from "./pwa";

function lerPreferencia(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}
function gravarPreferencia(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* navegador sem armazenamento local */
  }
}

/** Lê a tela do endereço; um endereço antigo ou desconhecido é trocado pelo novo sem criar histórico. */
function lerEndereco() {
  const novo = enderecoCanonico(location.hash);
  if (novo !== null) history.replaceState(null, "", novo);
  return telaDoEndereco(location.hash);
}

/** "%C3%A1" vira "á"; um endereço malformado não derruba a tela. */
function decodificar(t: string | null): string | null {
  if (t === null) return null;
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

type Sessao = "verificando" | "dentro" | "fora";
type Tema = "light" | "dark";

const COR_BARRA: Record<Tema, string> = { light: "#0b6b62", dark: "#151d20" };

/** Tema escolhido por você; sem escolha, segue o aparelho. O index.html aplica a escolha antes de desenhar. */
function temaAtual(): Tema {
  const t = lerPreferencia("tf-tema");
  if (t === "light" || t === "dark") return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function aplicarTema(t: Tema) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", COR_BARRA[t]);
}

/** Do dia 1 ao 7, avisa no Início que o resumo do mês anterior está pronto (se o mês teve lançamentos). */
function avisoFechamento(brutos: Brutos): boolean {
  const hoje = hojeISO();
  if (Number(hoje.slice(8, 10)) > 7) return false;
  const mes = addMes(hoje.slice(0, 7), -1);
  return brutos.movimentacoes.some((m) => compDe(m) === mes);
}

export default function App() {
  const [sessao, setSessao] = useState<Sessao>("verificando");
  const [lento, setLento] = useState(false);
  const [erroSessao, setErroSessao] = useState<string | null>(null);
  const [metodos, setMetodos] = useState<MetodosLogin>({ senha: true, google: false });

  // Enquanto o servidor acorda (plano grátis), tenta de novo a cada 3 segundos por até 2 minutos e meio.
  const verificar = useCallback(async () => {
    setErroSessao(null);
    const t = setTimeout(() => setLento(true), 4000);
    try {
      const s = await esperandoAcordar(() => api.sessao());
      if (s.metodos) setMetodos(s.metodos);
      setSessao(s.autenticado ? "dentro" : "fora");
    } catch (e) {
      setErroSessao(e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(t);
      setLento(false);
    }
  }, []);

  useEffect(() => {
    quandoPerderSessao(() => setSessao("fora"));
    verificar();
  }, [verificar]);

  if (sessao === "verificando") {
    return (
      <div className="login">
        <div className="panel login-card">
          {erroSessao ? (
            <>
              <div className="erro">
                {navigator.onLine === false
                  ? "Sem internet. Por segurança, os seus dados financeiros não ficam guardados no aparelho; conecte-se para ver."
                  : `Não consegui falar com o servidor (${erroSessao}).`}
              </div>
              <button type="button" onClick={verificar}>
                Tentar de novo
              </button>
            </>
          ) : (
            <Carregando lento={lento} />
          )}
        </div>
      </div>
    );
  }
  if (sessao === "fora") return <Login metodos={metodos} aoEntrar={() => setSessao("dentro")} />;
  return <Painel aoSair={() => setSessao("fora")} />;
}

function Painel({ aoSair }: { aoSair: () => void }) {
  const hoje = new Date();
  const [endereco, setEndereco] = useState(lerEndereco);
  const tela = endereco.tela;
  const [ano, setAno] = useState<number>(() => Number(lerPreferencia("tf-ano")) || hoje.getFullYear());
  const [mes, setMes] = useState<number | null>(() => {
    const m = lerPreferencia("tf-mes");
    return m === null ? hoje.getMonth() + 1 : m === "todos" ? null : Number(m);
  });
  const [visao, setVisao] = useState<Visao | null>(null);
  const [brutos, setBrutos] = useState<Brutos | null>(null);
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [ind, setInd] = useState<Indicadores | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizandoTaxas, setAtualizandoTaxas] = useState(false);
  const [avisoTaxas, setAvisoTaxas] = useState<string | null>(null);
  const [carregadoEm, setCarregadoEm] = useState<Date | null>(null);
  const [ocultar, setOcultar] = useState(() => lerPreferencia("tf-ocultar") === "1");
  const [simples, setSimples] = useState(() => lerPreferencia("tf-modo") === "simples");
  const [tema, setTema] = useState<Tema>(temaAtual);
  const [fonte, setFonte] = useState<FonteDados>(() => (lerPreferencia("tf-fonte") === "documentos" ? "documentos" : "banco"));
  // No celular o menu lateral não aparece, então a preferência só vale no computador.
  const [recolhido, setRecolhido] = useState(() => lerPreferencia("tf-menu") === "recolhido");
  const [lancando, setLancando] = useState(false);
  /** Aviso curto depois de lançar; `desfazer` é o id do lançamento que o botão "Desfazer" apaga. */
  const [aviso, setAviso] = useState<{ texto: string; desfazer?: string } | null>(null);
  const [desfazendo, setDesfazendo] = useState(false);
  const comBanco = fonte === "banco";
  // No modo simples o período é sempre o mês atual, sem mexer na escolha do modo completo.
  const anoVisto = simples ? hoje.getFullYear() : ano;
  const mesVisto = simples ? hoje.getMonth() + 1 : mes;
  // Aplicado antes de desenhar: vale para todas as telas e gráficos.
  definirOcultar(ocultar);

  function alternarOcultar() {
    setOcultar((v) => {
      gravarPreferencia("tf-ocultar", v ? "0" : "1");
      return !v;
    });
  }

  function alternarRecolhido() {
    setRecolhido((v) => {
      gravarPreferencia("tf-menu", v ? "aberto" : "recolhido");
      return !v;
    });
  }

  function alternarModo(s: boolean) {
    gravarPreferencia("tf-modo", s ? "simples" : "completo");
    setSimples(s);
  }

  function escolherFonte(f: FonteDados) {
    gravarPreferencia("tf-fonte", f);
    setFonte(f);
  }

  function escolherTema(t: Tema) {
    gravarPreferencia("tf-tema", t);
    aplicarTema(t);
    setTema(t);
  }

  function mudarPeriodo(a: number, m: number | null) {
    setAno(a);
    setMes(m);
  }

  // Sem escolha gravada, acompanha a troca de tema do aparelho.
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const f = () => {
      if (!lerPreferencia("tf-tema")) setTema(mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);

  const carregar = useCallback(async () => {
    try {
      const [v, b, f, i] = await esperandoAcordar(() => Promise.all([api.visaoGeral(anoVisto, mesVisto, fonte), api.brutos(fonte), api.fontes(), api.indicadores()]));
      setVisao(v);
      setBrutos(b);
      setFontes(f);
      setInd(i);
      setErro(null);
      setCarregadoEm(new Date());
    } catch (e) {
      if (!(e instanceof SemSessao)) setErro(e instanceof Error ? e.message : String(e));
    }
  }, [anoVisto, mesVisto, fonte]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    gravarPreferencia("tf-ano", String(ano));
    gravarPreferencia("tf-mes", mes === null ? "todos" : String(mes));
  }, [ano, mes]);

  useEffect(() => {
    const f = () => {
      setEndereco(lerEndereco());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);

  // Aviso curto depois de lançar; some sozinho.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.desfazer ? 6000 : 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  // Na primeira visita, abre no último mês que tem dados.
  useEffect(() => {
    if (lerPreferencia("tf-visitado") || !visao?.ultima_competencia_com_dados) return;
    gravarPreferencia("tf-visitado", "1");
    const [a, m] = visao.ultima_competencia_com_dados.split("-").map(Number);
    setAno(a);
    setMes(m);
  }, [visao]);

  async function atualizarTaxas() {
    setAtualizandoTaxas(true);
    setAvisoTaxas(null);
    try {
      const r = await api.atualizarIndicadores();
      const falhas = r.series.filter((s) => !s.ok);
      setAvisoTaxas(
        !r.gravado
          ? `Não consegui consultar o Banco Central: ${falhas[0]?.erro ?? "erro desconhecido"}`
          : falhas.length
            ? `Atualizado, exceto séries ${falhas.map((f) => f.sgs).join(", ")}.`
            : null,
      );
      await carregar();
    } catch (e) {
      setAvisoTaxas(e instanceof Error ? e.message : String(e));
    } finally {
      setAtualizandoTaxas(false);
    }
  }

  async function sair() {
    await Promise.race([desativarEste(true).catch(() => {}), new Promise((r) => setTimeout(r, 2000))]); // no máximo 2s: este aparelho não deve receber avisos de quem saiu
    await api.sair().catch(() => {});
    limparCacheLocal();
    aoSair();
  }

  const irParaPendentes = useCallback(() => {
    setLancando(false);
    location.hash = destinoPendentes();
  }, []);
  const fecharLancar = useCallback(() => setLancando(false), []);

  // O lançamento entra sem categoria: Movimentos mostra onde escolher (entrada na aba Entradas, gasto nos pendentes).
  async function lancado(mov: Movimentacao) {
    setLancando(false);
    const entrada = ehEntrada(mov);
    setAviso({ texto: "Lançado. Escolha a categoria em Movimentos.", desfazer: mov.id });
    // A lista mostra só o período escolhido: vai para o mês do lançamento.
    const p = simples ? null : periodoDoLancamento(mov.data, ano, mes);
    if (p) mudarPeriodo(p.ano, p.mes);
    location.hash = entrada ? "#movimentos/entradas" : destinoPendentes();
    await carregar();
  }

  const avisar = useCallback((texto: string) => setAviso({ texto }), []);
  async function concluirMigracao(texto: string) {
    setAviso({ texto });
    await carregar();
  }

  async function desfazerLancamento(id: string) {
    setDesfazendo(true);
    try {
      await api.apagarLancamento(id);
      setAviso({ texto: "Lançamento desfeito." });
      await carregar();
    } catch (e) {
      setAviso({ texto: `Não consegui desfazer: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setDesfazendo(false);
    }
  }

  const anos = visao?.anos_disponiveis ?? [hoje.getFullYear()];
  const ultimo = (chave: string) => {
    const r = ind?.series?.[chave]?.registros ?? [];
    return r.length ? r[r.length - 1] : null;
  };
  const selic = ultimo("selic_meta_aa");
  const cdi = ultimo("cdi_aa");
  const pendentes = brutos ? contarPendentes(brutos.movimentacoes, anoVisto, mesVisto) : 0;
  const contas = (brutos?.contas ?? []).map((c) => ({ id: c.id, nome: nomeConta(c) }));
  // "#movimentos/<id>/mes-a-mes" abre a análise mês a mês (página Gastos); o resto é a tela Movimentos.
  const mostrarAvisoFechamento = tela === "inicio" && brutos ? avisoFechamento(brutos) : false;
  const mesAMes = tela === "movimentos" ? decodificar(rotaMovimentos(endereco.detalhe ?? "", []).mesAMes) : null;

  return (
    <div className={"app" + (recolhido ? " recolhido" : "")}>
      <MenuLateral tela={tela} recolhido={recolhido} pendentes={pendentes} aoRecolher={alternarRecolhido} aoLancar={() => setLancando(true)} />
      <div className="coluna">
        <BarraTopo
          ano={anoVisto}
          mes={mesVisto}
          anos={anos}
          aoMudarPeriodo={mudarPeriodo}
          comPeriodo={!simples}
          comBanco={comBanco}
          pendentes={pendentes}
          aoPendentes={irParaPendentes}
          ocultar={ocultar}
          aoOcultar={alternarOcultar}
          carregadoEm={carregadoEm}
          aoSincronizado={carregar}
        />
        <main className="conteudo">
          {avisoTaxas && <div className="erro">{avisoTaxas}</div>}
          {erro && <div className="erro">Não consegui carregar os dados ({erro}). Use o botão de atualizar no alto da tela para tentar de novo.</div>}
          {!brutos && !erro && <p className="note">Carregando…</p>}

          {tela === "inicio" && !simples && (
            <div className="row">
              <span className="chip">
                <span className={"dot " + (cdi || selic ? "ok" : "")} />
                {cdi || selic
                  ? [selic && `Selic meta ${numero(selic.valor)}% a.a.`, cdi && `CDI ${numero(cdi.valor)}% a.a. em ${data(cdi.data)}`].filter(Boolean).join(" · ") +
                    ` · BCB, consultado em ${data(ind?.atualizado_em)}`
                  : "Selic e CDI: nenhuma consulta ainda"}
                <button type="button" className="btn-link" onClick={atualizarTaxas} disabled={atualizandoTaxas}>
                  {atualizandoTaxas ? "consultando…" : "consultar agora"}
                </button>
              </span>
            </div>
          )}
          {tela === "inicio" && !simples && brutos && !brutos.categoriasMigradas && (
            <div className="row">
              <a className="chip aviso-categorias" href="#categorias">
                <span className="dot warn" />
                Organize as suas categorias: escolha quais viram grupo
              </a>
            </div>
          )}
          {tela === "inicio" && mostrarAvisoFechamento && (
            <div className="row">
              <a className="chip aviso-categorias" href={`#fechamento/${addMes(hojeISO().slice(0, 7), -1)}`}>
                <span className="dot ok" />
                O resumo de {MESES[Number(addMes(hojeISO().slice(0, 7), -1).slice(5)) - 1]} está pronto
              </a>
            </div>
          )}
          {tela === "inicio" && !comBanco && (
            <div className="row">
              <span className="chip">
                <span className="dot ok" />
                Modelo por documentos: só extratos, faturas e holerites enviados
              </span>
            </div>
          )}

          {tela === "inicio" && visao && brutos && simples && <Simples visao={visao} brutos={brutos} comBanco={comBanco} aoCompleto={() => alternarModo(false)} />}
          {tela === "inicio" && visao && brutos && !simples && comBanco && <VisaoGeral visao={visao} brutos={brutos} aoMudar={carregar} />}
          {tela === "inicio" && visao && !simples && !comBanco && <VisaoGeralAntiga visao={visao} />}
          {tela === "salarios" && brutos && <Salarios brutos={brutos} ano={anoVisto} mes={mesVisto} />}
          {tela === "dividas" && brutos && <Dividas brutos={brutos} aoMudar={carregar} ano={anoVisto} mes={mesVisto} />}
          {tela === "pessoas" && brutos && <Pessoas brutos={brutos} aoMudar={carregar} />}
          {tela === "objetivos" && brutos && <Objetivos brutos={brutos} aoMudar={carregar} />}
          {tela === "fechamento" && brutos && <Fechamento brutos={brutos} detalhe={endereco.detalhe} />}
          {tela === "analises" && brutos && visao && <Analises brutos={brutos} visao={visao} ano={anoVisto} mes={mesVisto} />}
          {tela === "fixas" && brutos && <Fixas brutos={brutos} aoMudar={carregar} ano={anoVisto} mes={mesVisto} />}
          {tela === "movimentos" && brutos && mesAMes !== null && <Gastos brutos={brutos} aoMudar={carregar} categoria={mesAMes} />}
          {tela === "movimentos" && brutos && mesAMes === null && (
            <Movimentos brutos={brutos} ano={anoVisto} mes={mesVisto} endereco={decodificar(endereco.detalhe) ?? ""} aoMudar={carregar} avisar={avisar} />
          )}
          {tela === "categorias" && brutos && !brutos.categoriasMigradas && <Migracao aoConcluir={concluirMigracao} />}
          {tela === "categorias" && brutos && brutos.categoriasMigradas && (
            <Categorias brutos={brutos} ano={anoVisto} mes={mesVisto} aoMudar={carregar} avisar={avisar} />
          )}
          {tela === "mais" && <Mais />}
          {tela === "ajustes" && brutos && (
            <Enviar
              brutos={brutos}
              fontes={fontes}
              comBanco={comBanco}
              aoMudar={carregar}
              preferencias={
                <div className="prefs">
                  <div className="pref">
                    <span className="rotulo-campo">Modo de exibição</span>
                    <div className="row">
                      <div className="segmentos modo" role="group" aria-label="Modo de exibição">
                        <button type="button" aria-pressed={simples} onClick={() => alternarModo(true)}>
                          Simples
                        </button>
                        <button type="button" aria-pressed={!simples} onClick={() => alternarModo(false)}>
                          Completo
                        </button>
                      </div>
                      <button type="button" onClick={sair}>
                        Sair
                      </button>
                    </div>
                    <p className="note">{simples ? "Simples: o Início mostra só o mês atual, em poucas linhas." : "Completo: o Início mostra todos os quadros do período escolhido."}</p>
                  </div>
                  <div className="pref">
                    <span className="rotulo-campo">Tema</span>
                    <div className="segmentos modo" role="group" aria-label="Tema">
                      <button type="button" aria-pressed={tema === "light"} onClick={() => escolherTema("light")}>
                        Claro
                      </button>
                      <button type="button" aria-pressed={tema === "dark"} onClick={() => escolherTema("dark")}>
                        Escuro
                      </button>
                    </div>
                  </div>
                  <div className="pref">
                    <span className="rotulo-campo">De onde vêm os dados</span>
                    <div className="segmentos modo" role="group" aria-label="De onde vêm os dados">
                      <button type="button" aria-pressed={comBanco} onClick={() => escolherFonte("banco")}>
                        Banco (automático)
                      </button>
                      <button type="button" aria-pressed={!comBanco} onClick={() => escolherFonte("documentos")}>
                        Documentos (legado)
                      </button>
                    </div>
                    <p className="note">
                      {comBanco
                        ? "O sistema lê a conta e o cartão direto do banco, todos os dias."
                        : "Modelo antigo: só valem os extratos, faturas e holerites que você envia. A Visão geral volta ao formato antigo."}
                    </p>
                  </div>
                  {comBanco && (
                    <div className="pref">
                      <span className="rotulo-campo">Conexão com o banco</span>
                      <div className="row">
                        <Sincronizacao aoSincronizar={carregar} />
                      </div>
                    </div>
                  )}
                  <div className="pref">
                    <span className="rotulo-campo">App no celular</span>
                    <div className="row">
                      <BotaoInstalar />
                      {instalado() ? (
                        <span className="note">Já instalado neste aparelho.</span>
                      ) : (
                        !podeInstalar() && !ehIos() && <span className="note">Abra o site no celular para instalar.</span>
                      )}
                    </div>
                  </div>
                </div>
              }
            />
          )}
        </main>
      </div>
      <BarraDeBaixo tela={tela} aoLancar={() => setLancando(true)} />
      {lancando && <Lancar pendentes={pendentes} contas={contas} aoFechar={fecharLancar} aoSalvo={lancado} aoOrganizar={irParaPendentes} />}
      {aviso && (
        <div className="aviso-flutuante" role="status">
          {aviso.texto}
          {aviso.desfazer && (
            <button type="button" className="aviso-desfazer" onClick={() => desfazerLancamento(aviso.desfazer!)} disabled={desfazendo}>
              {desfazendo ? "Desfazendo…" : "Desfazer"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BotaoInstalar() {
  const [, render] = useState(0);
  const [dicaIos, setDicaIos] = useState(false);
  useEffect(() => aoMudarInstalacao(() => render((n) => n + 1)), []);
  if (instalado()) return null;
  if (podeInstalar())
    return (
      <button type="button" onClick={() => instalar()}>
        Instalar app
      </button>
    );
  if (!ehIos()) return null;
  return (
    <>
      <button type="button" onClick={() => setDicaIos((v) => !v)} aria-expanded={dicaIos}>
        Instalar app
      </button>
      {dicaIos && (
        <p className="note dica-instalar" role="status">
          No Safari, toque em Compartilhar e depois em <b>Adicionar à Tela de Início</b>.
        </p>
      )}
    </>
  );
}

/** Tela de espera: igual à que o index.html mostra antes do JavaScript carregar. */
function Carregando({ lento }: { lento: boolean }) {
  return (
    <div className="carregando" role="status" aria-live="polite">
      <span className="carregando-marca" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 64 64">
          <path d="M16 44V30M28 44V22M40 44V34M52 44V16" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
        </svg>
      </span>
      <b>Estamos carregando seus dados</b>
      <span className="carregando-barra" aria-hidden="true">
        <i />
      </span>
      <span className="note">{lento ? "Na primeira vez do dia pode levar até um minuto. Já já fica pronto." : " "}</span>
    </div>
  );
}
