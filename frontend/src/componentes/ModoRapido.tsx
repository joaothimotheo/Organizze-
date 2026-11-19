import { useMemo, useState } from "react";
import { api, type Brutos, type Grupo } from "../api";
import { data, reais } from "../formato";
import { ehEntrada } from "../grupos";
import { aplicarEscolha, contarRapido, corpoEdicao, pedeQuemRapido } from "../movimentos";
import { nomeConta } from "../paginas/Enviar";
import Janela, { Grade, ResumoLancamento } from "./Janela";
import { opcoesDeGrupo, opcoesNaoConta } from "./JanelaCategoria";
import { tituloDe } from "./NomeLancamento";

const msgDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const TAMANHO_QUEM = 60;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Modo "um por um": mostra um pendente por vez (a fila vem pronta, os mais antigos primeiro). Um
 * toque no grupo salva com "mesma descrição" e passa ao próximo sem esperar recarregar; os que o
 * servidor já organizou junto saem da fila. No fim, "Pronto!" com quantos foram organizados e pulados.
 * `aoFim` (recarregar e fechar) é chamado ao sair se algo foi salvo; senão, `aoFechar`.
 */
export default function ModoRapido({
  fila,
  brutos,
  aoFim,
  aoFechar,
}: {
  fila: string[];
  brutos: Brutos;
  aoFim: () => Promise<void> | void;
  aoFechar: () => void;
}) {
  const migrado = brutos.categoriasMigradas;
  const grupos = brutos.categorias as unknown as Grupo[];
  const porId = useMemo(() => new Map(brutos.movimentacoes.map((m) => [m.id, m])), [brutos.movimentacoes]);
  const contas = useMemo(() => new Map(brutos.contas.map((c) => [c.id, nomeConta(c)])), [brutos.contas]);
  // A fila não muda enquanto a janela está aberta (os dados só recarregam no fim).
  const [ids] = useState(() => fila.filter((id) => porId.has(id)));
  const [i, setI] = useState(0);
  const [resolvidos, setResolvidos] = useState<Set<string>>(() => new Set());
  const [puladosIds, setPuladosIds] = useState<Set<string>>(() => new Set());
  // Algum salvamento levou grupo (e com ele a regra da mesma descrição)?
  const [comCategoria, setComCategoria] = useState(false);
  const [quem, setQuem] = useState(() => (ids[0] ? (porId.get(ids[0])?.quem ?? "") : ""));
  const [salvando, setSalvando] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const { feitos, pulados } = contarRapido(ids, resolvidos, puladosIds);
  const mov = i < ids.length ? porId.get(ids[i]) : undefined;
  const fim = !mov;

  function avancar(feitosAgora: Set<string>) {
    let j = i + 1;
    while (j < ids.length && feitosAgora.has(ids[j])) j++;
    setI(j);
    setErro(null);
    setQuem(j < ids.length ? (porId.get(ids[j])?.quem ?? "") : "");
  }

  async function escolher(opcao: string) {
    if (!mov || salvando) return;
    const pede = pedeQuemRapido(mov);
    if (pede && quem.trim().length > TAMANHO_QUEM) return setErro(`Quem pode ter até ${TAMANHO_QUEM} letras.`);
    const escolha = aplicarEscolha(mov, { categoria: mov.categoria || "a_classificar", natureza: mov.natureza }, opcao, migrado);
    const corpo = corpoEdicao(mov, { ...escolha, quem: pede ? quem : undefined, partes: null }, migrado);
    if (!corpo) return pular();
    if (corpo.categoria) corpo.mesma_descricao = true;
    setSalvando(true);
    setErro(null);
    try {
      const r = await api.editarLancamento(mov.id, corpo);
      const novos = new Set([...resolvidos, mov.id, ...(r.alterados ?? [])]);
      setResolvidos(novos);
      if (corpo.categoria) setComCategoria(true);
      avancar(novos);
    } catch (e) {
      setErro(`Não consegui salvar: ${msgDe(e)}`);
    } finally {
      setSalvando(false);
    }
  }

  function pular() {
    if (mov) setPuladosIds((p) => new Set(p).add(mov.id));
    avancar(resolvidos);
  }

  async function sair() {
    if (salvando || saindo) return;
    if (feitos === 0) return aoFechar();
    setSaindo(true);
    try {
      await aoFim();
    } finally {
      setSaindo(false);
    }
  }

  if (fim)
    return (
      <Janela idTitulo="rp-titulo" ocupada={saindo} aoFechar={sair}>
        <div className="jn-pronto">
          <h3 id="rp-titulo">Pronto!</h3>
          <p>
            {plural(feitos, "organizado", "organizados")}
            {pulados > 0 && `, ${plural(pulados, "pulado", "pulados")}`}.{comCategoria && " Os próximos iguais já seguem as suas escolhas."}
          </p>
          <div className="janela-acoes">
            <button type="button" className="primary" onClick={sair} disabled={saindo}>
              {saindo ? "Atualizando…" : "Fechar"}
            </button>
          </div>
        </div>
      </Janela>
    );

  const entrada = ehEntrada(mov);
  const pede = pedeQuemRapido(mov);
  const conta = !mov.conta_id || mov.conta_id === "dinheiro" ? "Dinheiro" : contas.get(mov.conta_id);
  const ocupado = salvando || saindo;

  return (
    <Janela idTitulo="rp-titulo" ocupada={ocupado} passo={mov.id} focarJanela aoFechar={sair}>
      <div className="jn-topo">
        <h3 id="rp-titulo">Organizar</h3>
        <span className="note">
          {i + 1} de {ids.length}
        </span>
      </div>
      <div className="medidor" role="progressbar" aria-label="Andamento" aria-valuemin={0} aria-valuemax={ids.length} aria-valuenow={i}>
        <i style={{ width: `${(i / ids.length) * 100}%` }} />
      </div>
      <ResumoLancamento
        grande
        titulo={tituloDe(mov)}
        sub={[data(mov.data), conta, mov.nome ? mov.descricao : null].filter(Boolean).join(" · ")}
        valor={reais(mov.valor)}
        positivo={mov.valor > 0}
      />
      <div className="jn-sec">{entrada ? "De onde veio? Toque para salvar e ir ao próximo" : "Que gasto foi? Toque para salvar e ir ao próximo"}</div>
      <Grade opcoes={opcoesDeGrupo(mov, grupos, migrado)} rotulo={entrada ? "Origens de entrada" : "Grupos de gasto"} desativada={ocupado} aoEscolher={escolher} />
      <div className="jn-sec">{mov.valor < 0 ? "Não é gasto" : "Não é ganho"}</div>
      <Grade opcoes={opcoesNaoConta(mov)} rotulo={mov.valor < 0 ? "Não é gasto" : "Não é ganho"} desativada={ocupado} aoEscolher={escolher} />
      {pede && (
        <label className="field">
          <span className="rotulo-campo">{entrada ? "Quem mandou" : "Para quem"} (opcional)</span>
          <input type="text" maxLength={TAMANHO_QUEM} placeholder="Ex.: nome da pessoa ou empresa" value={quem} disabled={ocupado} onChange={(e) => setQuem(e.target.value)} />
        </label>
      )}
      {erro && <div className="erro">{erro}</div>}
      <div className="janela-acoes">
        <button type="button" onClick={sair} disabled={ocupado}>
          {saindo ? "Atualizando…" : "Sair"}
        </button>
        <button type="button" onClick={pular} disabled={ocupado}>
          Pular
        </button>
      </div>
    </Janela>
  );
}
