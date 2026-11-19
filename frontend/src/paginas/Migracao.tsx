import { useEffect, useState } from "react";
import { api, urlApi, type UsoAntigo } from "../api";
import { Painel, Vazio } from "../componentes/Indicador";

const msgDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Primeira vez na tela Categorias: você escolhe quais categorias de hoje viram grupo. Antes de
 * migrar, um passo de confirmação lembra que não dá para desfazer e oferece a cópia. Ao terminar, `aoConcluir` recebe o resumo e recarrega o app (que passa a mostrar os grupos).
 */
export default function Migracao({ aoConcluir }: { aoConcluir: (texto: string) => Promise<void> }) {
  const [lista, setLista] = useState<UsoAntigo[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [migrando, setMigrando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [feito, setFeito] = useState<string | null>(null);

  useEffect(() => {
    api
      .usoAntigo()
      .then((l) => {
        setLista(l);
        setMarcadas(new Set(l.filter((u) => u.marcada).map((u) => u.id)));
      })
      .catch((e) => setErro(`Não consegui carregar as categorias: ${msgDe(e)}`));
  }, []);

  function alternar(id: string, sim: boolean) {
    setMarcadas((s) => {
      const n = new Set(s);
      if (sim) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  async function migrar() {
    if (!lista) return;
    setMigrando(true);
    setErro(null);
    try {
      // Na ordem da lista, só as que ainda existem nela.
      const r = await api.migrar(lista.filter((u) => marcadas.has(u.id)).map((u) => u.id));
      const texto = `${r.grupos === 1 ? "1 grupo criado" : `${r.grupos} grupos criados`}, ${r.movidos === 1 ? "1 lançamento reorganizado" : `${r.movidos} lançamentos reorganizados`}.`;
      setFeito(texto);
      await aoConcluir(texto);
    } catch (e) {
      setErro(`Não consegui usar estas categorias: ${msgDe(e)}`);
      setMigrando(false);
      setConfirmando(false);
    }
  }

  return (
    <Painel
      titulo="Organize as suas categorias"
      descricao="Você escolhe quais das categorias de hoje viram grupo. As que ficarem desmarcadas vão para Outros gastos, com o nome antigo como detalhe; nada se perde."
    >
      {erro && <div className="erro">{erro}</div>}
      {feito && (
        <div className="ok-box" role="status">
          {feito}
        </div>
      )}
      {!lista && !erro && <p className="note">Carregando…</p>}
      {lista && lista.length === 0 && (
        <Vazio titulo="Nenhuma categoria de gasto para escolher">Ao continuar, os seus gastos ficam em Outros gastos e você cria os grupos que quiser.</Vazio>
      )}
      {lista && lista.length > 0 && (
        <div className="grupo-grade">
          {lista.map((u) => (
            <label key={u.id} className="grupo-item migrar">
              <input type="checkbox" checked={marcadas.has(u.id)} disabled={migrando || confirmando || feito !== null} onChange={(e) => alternar(u.id, e.target.checked)} />
              <span className="grupo-texto">
                <b>{u.nome}</b>
              </span>
              <span className="grupo-uso num">{u.usos ? `${u.usos}× em 12 meses` : "nunca usada"}</span>
            </label>
          ))}
        </div>
      )}
      <p className="note">
        Já vêm marcadas as que você usou 15 vezes ou mais nos últimos 12 meses. Pix no cartão não vira grupo: esses lançamentos vão para Outros gastos, com "Pix no cartão" como detalhe, e você
        escolhe depois o grupo do que foi pago. Salário e as outras entradas já viram origens de entrada.
      </p>
      {confirmando && feito === null ? (
        <div className="aviso-migrar" role="alertdialog" aria-labelledby="migrar-aviso">
          <p id="migrar-aviso">Isto reorganiza todos os seus lançamentos de uma vez e não dá para desfazer pelo app. Antes, baixe uma cópia de segurança.</p>
          <div className="row">
            <a className="botao" href={urlApi("/api/backup")} download>
              Baixar cópia (.json)
            </a>
            <button type="button" className="primary" onClick={migrar} disabled={migrando}>
              {migrando ? "Organizando…" : "Migrar agora"}
            </button>
            <button type="button" onClick={() => setConfirmando(false)} disabled={migrando}>
              Voltar
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="primary" onClick={() => (setErro(null), setConfirmando(true))} disabled={!lista || migrando || feito !== null}>
            Usar estas categorias
          </button>
          {lista && <span className="note">{marcadas.size === 1 ? "1 marcada" : `${marcadas.size} marcadas`}</span>}
        </div>
      )}
    </Painel>
  );
}
