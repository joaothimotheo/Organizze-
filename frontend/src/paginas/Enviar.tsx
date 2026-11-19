import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { api, urlApi, type Brutos, type ContaCadastrada, type Fonte, type Previa, type ResultadoImportacao } from "../api";
import { Painel, Vazio } from "../componentes/Indicador";
import { SeletorCategoria } from "../componentes/SeletorCategoria";
import { BuscarHistorico } from "../componentes/Sincronizacao";
import { data, mesAno, nomeCategoria, opcoesCategoria, reais, rotuloFora } from "../formato";
import { tipoDaNatureza } from "../grupos";

type Item =
  | { estado: "lendo"; chave: string; nome: string }
  | { estado: "erro"; chave: string; nome: string; erro: string }
  | { estado: "revisar"; chave: string; nome: string; previa: Previa }
  | { estado: "gravado"; chave: string; nome: string; titulo: string; resultado: ResultadoImportacao };

const TIPO: Record<Previa["tipo"], string> = { holerite: "Holerite", fatura_cartao: "Fatura do cartão", extrato: "Extrato bancário" };


function Revisao({ previa, aoGravar, aoDescartar }: { previa: Previa; aoGravar: (r: ResultadoImportacao) => void; aoDescartar: () => void }) {
  const [categorias, setCategorias] = useState<Record<string, string>>({});
  const [ignorar, setIgnorar] = useState<Set<string>>(new Set());
  const [soSemCategoria, setSoSemCategoria] = useState(previa.movimentacoes.some((m) => m.categoria === "a_classificar"));
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const conferenciasOk = previa.conferencias.every((c) => c.ok);
  const novas = previa.movimentacoes.filter((m) => !m.duplicada);
  const visiveis = previa.movimentacoes.filter((m) => !soSemCategoria || (categorias[m.id] ?? m.categoria) === "a_classificar" || m.id in categorias);
  const aGravar = novas.filter((m) => !ignorar.has(m.id)).length;
  const soOriginal = previa.ja_importado;

  async function gravar() {
    setGravando(true);
    setErro(null);
    try {
      aoGravar(await api.confirmar(previa.id, categorias, [...ignorar]));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setGravando(false);
    }
  }

  return (
    <div className="revisao">
      <div className="rev-cab">
        <div>
          <div className="eyebrow">{TIPO[previa.tipo]}</div>
          <h3>{previa.titulo}</h3>
          <div className="note">{previa.nome_arquivo}</div>
        </div>
        {soOriginal ? <span className="pill">já importado</span> : conferenciasOk ? <span className="pill ok">totais conferem</span> : <span className="pill warn">total diverge</span>}
      </div>

      <dl className="resumo">
        {previa.resumo.map(([r, v]) => (
          <div key={r}>
            <dt>{r}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      {previa.conferencias.length > 0 && (
        <ul className="conferencias">
          {previa.conferencias.map((c) => (
            <li key={c.descricao} className={c.ok ? "ok" : "bad"}>
              <span aria-hidden="true">{c.ok ? "✓" : "✗"}</span> {c.descricao}: {reais(c.no_documento)}
              {!c.ok && ` × ${reais(c.calculado)}`}
            </li>
          ))}
        </ul>
      )}

      {soOriginal ? (
        <p className="callout">
          Este arquivo já foi importado antes, então nada muda nos seus dados.{" "}
          {previa.original_guardado ? "O PDF original também já está guardado." : "Posso guardar só o arquivo original, para você consultar depois."}
        </p>
      ) : (
        previa.avisos.map((a) => (
          <p key={a} className="callout">
            {a}
          </p>
        ))
      )}
      {previa.substitui_holerite && !soOriginal && <p className="callout">Já existe um holerite desta competência; ao gravar, ele será substituído por este.</p>}

      {previa.holerite && !soOriginal && (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Linha</th>
                <th>Ref.</th>
                <th style={{ textAlign: "right" }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {previa.holerite.proventos.map((p, i) => (
                <tr key={"p" + i}>
                  <td>+ {p.descricao}</td>
                  <td>{p.referencia ?? ""}</td>
                  <td className="n">{reais(p.valor)}</td>
                </tr>
              ))}
              {previa.holerite.descontos.map((d, i) => (
                <tr key={"d" + i}>
                  <td>− {d.descricao}</td>
                  <td>{d.referencia ?? ""}</td>
                  <td className="n neg">{reais(-d.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previa.movimentacoes.length > 0 && !soOriginal && (
        <>
          <div className="row">
            <b>{previa.movimentacoes.length} lançamentos</b>
            {previa.duplicadas > 0 && <span className="note">{previa.duplicadas} já estavam gravados e serão ignorados</span>}
            <label className="check">
              <input type="checkbox" checked={soSemCategoria} onChange={(e) => setSoSemCategoria(e.target.checked)} /> só os sem categoria
            </label>
          </div>
          {visiveis.length ? (
            <ul className="lancs">
              {visiveis.map((m) => {
                const cat = categorias[m.id] ?? m.categoria ?? "a_classificar";
                const fora = m.duplicada || ignorar.has(m.id);
                const opcoes = opcoesCategoria(tipoDaNatureza(m.natureza));
                // O valor atual pode não estar na lista: opção desabilitada, como no SeletorCategoria.
                const foraDaLista = rotuloFora(cat, opcoes);
                return (
                  <li key={m.id} className={fora ? "fora" : ""}>
                    <div className="l1">
                      <span className="desc">{m.descricao}</span>
                      <span className={"n" + (m.valor < 0 ? "" : " pos")}>{reais(m.valor)}</span>
                    </div>
                    <div className="l2">
                      <span className="note">
                        {data(m.data_compra ?? m.data)}
                        {m.parcela ? ` · parcela ${m.parcela}` : ""}
                        {m.duplicada ? " · já gravado" : ""}
                      </span>
                      {m.natureza === "despesa" || m.natureza === "receita" ? (
                        <select
                          aria-label={`Categoria de ${m.descricao}`}
                          value={cat}
                          disabled={fora}
                          className={cat === "a_classificar" ? "falta" : ""}
                          onChange={(e) => setCategorias({ ...categorias, [m.id]: e.target.value })}
                        >
                          {foraDaLista !== null && (
                            <option value={cat} disabled>
                              {foraDaLista}
                            </option>
                          )}
                          {opcoes.map(([k, n]) => (
                            <option key={k} value={k}>
                              {n}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="pill">{nomeCategoria(m.categoria)}</span>
                      )}
                      {!m.duplicada && (
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={!ignorar.has(m.id)}
                            onChange={(e) => {
                              const n = new Set(ignorar);
                              if (e.target.checked) n.delete(m.id);
                              else n.add(m.id);
                              setIgnorar(n);
                            }}
                          />{" "}
                          gravar
                        </label>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="note">Todos os lançamentos têm categoria. Desmarque "só os sem categoria" para ver a lista inteira.</p>
          )}
        </>
      )}

      {erro && <div className="erro">{erro}</div>}
      <div className="row">
        {soOriginal ? (
          !previa.original_guardado && (
            <button type="button" className="primary" onClick={gravar} disabled={gravando}>
              {gravando ? "Guardando…" : "Guardar o PDF original"}
            </button>
          )
        ) : (
          <button type="button" className="primary" onClick={gravar} disabled={gravando}>
            {gravando ? "Gravando…" : previa.movimentacoes.length ? `Gravar ${aGravar} lançamento${aGravar === 1 ? "" : "s"}` : "Gravar holerite"}
          </button>
        )}
        <button type="button" onClick={aoDescartar} disabled={gravando}>
          {soOriginal && previa.original_guardado ? "Fechar" : "Descartar"}
        </button>
      </div>
    </div>
  );
}

function SemCategoria({ brutos, aoMudar }: { brutos: Brutos; aoMudar: () => Promise<void> }) {
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const pendentes = brutos.movimentacoes.filter((m) => m.categoria === "a_classificar").sort((a, b) => a.valor - b.valor);
  const total = pendentes.reduce((s, m) => s - m.valor, 0);

  async function escolher(id: string, categoria: string) {
    setSalvando(id);
    setErro(null);
    try {
      await api.reclassificar(id, categoria, true);
      await aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(null);
    }
  }

  if (!pendentes.length) return <Vazio titulo="Tudo classificado">Nenhum lançamento sem categoria.</Vazio>;
  return (
    <>
      <p className="note">
        {pendentes.length} lançamentos somando {reais(total)}. Ao escolher, os outros com a mesma descrição também mudam, e as próximas faturas já chegam classificadas.
      </p>
      {erro && <div className="erro">{erro}</div>}
      <ul className="lancs">
        {pendentes.map((m) => (
          <li key={m.id}>
            <div className="l1">
              <span className="desc">{m.descricao}</span>
              <span className="n">{reais(m.valor)}</span>
            </div>
            <div className="l2">
              <span className="note">
                {data(m.data_compra ?? m.data)} · fatura de {mesAno(m.competencia)}
              </span>
              <SeletorCategoria rotulo={`Categoria de ${m.descricao}`} natureza={m.natureza} className="falta" valor="a_classificar" desativado={salvando !== null} aoEscolher={(c) => escolher(m.id, c)} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Nome de uma conta como aparece em Ajustes (banco · apelido · final). */
export const nomeConta = (c: ContaCadastrada) =>
  [c.instituicao && !c.instituicao.includes("Pluggy") ? c.instituicao : null, c.apelido, c.final ? `final ${c.final}` : null].filter(Boolean).join(" · ") || c.id;

/** Escolha, por conta corrente, se é do dia a dia ou a reserva de emergência. */
function PapelContas({ brutos, aoMudar }: { brutos: Brutos; aoMudar: () => Promise<void> }) {
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const correntes = brutos.contas.filter((c) => (c.tipo ?? "").includes("corrente"));
  const nome = nomeConta;

  async function mudar(c: ContaCadastrada, papel: "reserva" | null) {
    setSalvando(c.id);
    setErro(null);
    try {
      await api.mudarPapelConta(c.id, papel);
      await aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(null);
    }
  }

  if (!correntes.length) return <Vazio titulo="Nenhuma conta corrente">As contas aparecem aqui depois da primeira sincronização ou do primeiro extrato.</Vazio>;
  return (
    <>
      {erro && <div className="erro">{erro}</div>}
      <ul className="cat-lista">
        {correntes.map((c) => (
          <li key={c.id}>
            <div className="cat-item">
              <span>
                <b>{nome(c)}</b>
                <span className="note"> {brutos.movimentacoes.filter((m) => m.conta_id === c.id).length} lançamentos</span>
              </span>
              <div className="segmentos" role="group" aria-label={`Papel de ${nome(c)}`}>
                <button type="button" aria-pressed={c.papel !== "reserva"} disabled={salvando === c.id} onClick={() => mudar(c, null)}>
                  Dia a dia
                </button>
                <button type="button" aria-pressed={c.papel === "reserva"} disabled={salvando === c.id} onClick={() => mudar(c, "reserva")}>
                  Reserva
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Enviar({
  brutos,
  fontes,
  comBanco,
  aoMudar,
  preferencias,
}: {
  brutos: Brutos;
  fontes: Fonte[];
  comBanco: boolean;
  aoMudar: () => Promise<void>;
  preferencias: ReactNode;
}) {
  const [itens, setItens] = useState<Item[]>([]);
  const [msgBackup, setMsgBackup] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const entradaBackup = useRef<HTMLInputElement>(null);

  const atualizar = (chave: string, novo: Item | null) => setItens((l) => (novo ? l.map((x) => (x.chave === chave ? novo : x)) : l.filter((x) => x.chave !== chave)));

  async function escolher(ev: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(ev.target.files ?? []);
    ev.target.value = "";
    for (const f of arquivos) {
      const chave = `${f.name}-${Date.now()}-${Math.random()}`;
      setItens((l) => [...l, { estado: "lendo", chave, nome: f.name }]);
      try {
        const previa = await api.analisar(f);
        atualizar(chave, { estado: "revisar", chave, nome: f.name, previa });
      } catch (e) {
        atualizar(chave, { estado: "erro", chave, nome: f.name, erro: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  async function restaurar(ev: ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    ev.target.value = "";
    if (!f) return;
    if (!window.confirm(`Substituir todos os dados atuais pelo conteúdo de "${f.name}"? A versão atual fica guardada no histórico do banco.`)) return;
    setMsgBackup("Restaurando…");
    try {
      const r = await api.restaurarBackup(await f.text());
      await aoMudar();
      setMsgBackup(`Restaurado: ${r.restaurados.join(", ")}.`);
    } catch (e) {
      setMsgBackup(`Não restaurei: ${e instanceof Error ? e.message : e}`);
    }
  }

  const docs = [...brutos.documentos].sort((a, b) => (b.competencia ?? "").localeCompare(a.competencia ?? "") || a.tipo.localeCompare(b.tipo));

  return (
    <section className="grid">
      <Painel titulo="Aparência e dados" descricao="Preferências deste aparelho.">
        {preferencias}
      </Painel>

      <Painel titulo="Lançamentos sem categoria" descricao="Escolha a categoria; o sistema aprende para as próximas importações.">
        <SemCategoria brutos={brutos} aoMudar={aoMudar} />
      </Painel>

      <Painel
        titulo="Suas contas"
        descricao="A reserva de emergência aparece à parte: fica fora do saldo do dia a dia, mas entra no patrimônio. Transferências entre as suas contas não contam como receita nem como gasto."
      >
        <PapelContas brutos={brutos} aoMudar={aoMudar} />
      </Painel>

      {comBanco && (
        <Painel titulo="Histórico do banco" descricao="Para trazer de uma vez o último ano da conta e do cartão.">
          <BuscarHistorico aoSincronizar={aoMudar} />
        </Painel>
      )}

      <details className="legado" open={!comBanco || itens.length > 0}>
        <summary>
          Documentos (legado)
          <span className="note">Envio de extratos, faturas em PDF e holerites, do jeito antigo. Com o banco conectado, não precisa mais.</span>
        </summary>
        <div className="grid">
          <Painel titulo="Enviar documentos" descricao="Holerite em PDF, fatura do cartão Santander em PDF e extrato da conta em OFX ou CSV. Nada é gravado antes de você revisar.">
            <div className="row">
              <button type="button" className="primary" onClick={() => entrada.current?.click()}>
                Escolher arquivos
              </button>
              <span className="note">Dá para escolher os três de uma vez. Use o PDF sem senha que o app do banco gera.</span>
            </div>
            <input ref={entrada} type="file" multiple accept=".pdf,.ofx,.csv,.txt,application/pdf,text/csv" hidden onChange={escolher} />
            {itens.map((it) => (
              <div key={it.chave} className="item-envio">
                {it.estado === "lendo" && <p className="note">Lendo {it.nome}…</p>}
                {it.estado === "erro" && (
                  <div className="erro row">
                    <span>
                      <b>{it.nome}</b>: {it.erro}
                    </span>
                    <button type="button" className="del" onClick={() => atualizar(it.chave, null)}>
                      Fechar
                    </button>
                  </div>
                )}
                {it.estado === "revisar" && (
                  <Revisao
                    previa={it.previa}
                    aoGravar={async (resultado) => {
                      atualizar(it.chave, { estado: "gravado", chave: it.chave, nome: it.nome, titulo: it.previa.titulo, resultado });
                      await aoMudar();
                    }}
                    aoDescartar={() => {
                      api.descartar(it.previa.id).catch(() => {});
                      atualizar(it.chave, null);
                    }}
                  />
                )}
                {it.estado === "gravado" && (
                  <div className="ok-box row">
                    <span>
                      <b>{it.titulo}</b>:{" "}
                      {it.resultado.so_original
                        ? it.resultado.original_guardado
                          ? "PDF original guardado."
                          : "o original já estava guardado."
                        : [
                            it.resultado.holerite && "holerite gravado",
                            it.resultado.movimentacoes_gravadas > 0 && `${it.resultado.movimentacoes_gravadas} lançamentos gravados`,
                            it.resultado.movimentacoes_ignoradas > 0 && `${it.resultado.movimentacoes_ignoradas} ignorados`,
                            it.resultado.saldo_divida && "saldo do cartão atualizado",
                          ]
                            .filter(Boolean)
                            .join(" · ") + "."}
                    </span>
                    <button type="button" className="del" onClick={() => atualizar(it.chave, null)}>
                      Fechar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </Painel>

          <Painel titulo="Documentos importados" descricao="Cada registro aponta para o documento de onde veio.">
            {docs.length ? (
              <ul className="docs">
                {docs.map((d) => (
                  <li key={d.id}>
                    <div>
                      <b>{d.tipo === "holerite" ? "Holerite" : d.tipo === "fatura_cartao" ? "Fatura" : "Extrato"}</b> · {mesAno(d.competencia)}
                      {d.total_fatura != null && <span className="note"> · {reais(d.total_fatura)}</span>}
                    </div>
                    {d.original && d.sha256 ? (
                      <a href={urlApi(`/api/originais/${d.sha256}`)} target="_blank" rel="noopener">
                        abrir PDF
                      </a>
                    ) : (
                      <span className="note" title="Importado antes do sistema online. Envie o mesmo PDF de novo para guardar o original.">
                        sem original
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Vazio titulo="Nenhum documento ainda">Os documentos aparecem aqui depois de gravados.</Vazio>
            )}
          </Painel>

        </div>
      </details>

      <Painel largo titulo="Cópia de segurança" descricao="Baixe uma cópia de todos os dados de vez em quando. O plano grátis do banco não tem backup automático garantido.">
        <div className="row">
          <a className="botao" href={urlApi("/api/backup")} download>
            Baixar cópia (.json)
          </a>
          <button type="button" onClick={() => entradaBackup.current?.click()}>
            Restaurar uma cópia
          </button>
          {msgBackup && <span className="note">{msgBackup}</span>}
        </div>
        <input ref={entradaBackup} type="file" accept=".json,application/json" hidden onChange={restaurar} />
        <p className="note">A cópia não inclui os PDFs originais, só os dados lidos deles.</p>
      </Painel>

      <Painel largo titulo="Dados guardados" descricao="O que já está gravado em cada conjunto. O que nunca foi enviado aparece como pendente, nunca como zero.">
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Conteúdo</th>
                <th style={{ textAlign: "right" }}>Registros</th>
                <th>Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {fontes.map((f) => (
                <tr key={f.arquivo}>
                  <td>
                    {f.descricao} <span className="note">{f.arquivo}</span>
                  </td>
                  <td className="n">{f.erro ? "erro" : f.existe ? (f.registros ?? 0) : "pendente"}</td>
                  <td>{f.erro ?? (f.existe ? (f.atualizado_em ? data(f.atualizado_em) : "nunca") : "nunca enviado")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Painel>
    </section>
  );
}
