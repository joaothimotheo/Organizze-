/** Regras do aviso de conexão com o banco e da hora mostrada na barra do topo (sem React, testáveis no Node). */
import type { EstadoSync } from "./api";

const DIA = 24 * 3600 * 1000;

export type AvisoConexao = { nivel: "erro" | "atencao" | null; texto: string };

const dias = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

/**
 * O que a barra do topo avisa sobre a conexão com o banco (o detalhe fica em Ajustes):
 * - erro: a última sincronização falhou, ou alguma conexão está com erro ou precisando renovar;
 * - atenção: a última sincronização boa tem mais de 2 dias, ou a autorização vence em até 30 dias.
 */
export function problemaNaConexao(e: EstadoSync | null, agora: Date = new Date()): AvisoConexao {
  if (!e?.configurada) return { nivel: null, texto: "" };
  const ex = e.ultima_ok;
  const conexoes = ex?.conexoes ?? (ex?.conexao ? [ex.conexao] : []);
  const comErro = conexoes.some((c) => Boolean(c.erro) || (Boolean(c.status) && c.status !== "UPDATED" && c.status !== "UPDATING"));
  if ((e.ultima && !e.ultima.ok) || comErro) return { nivel: "erro", texto: "Problema na conexão com o banco" };
  const d = dadosDoBanco(e);
  if (d && agora.getTime() - d.em.getTime() > DADOS_VELHOS_MS) {
    return { nivel: "atencao", texto: `Dados do banco de ${quando(d.em, agora)}` };
  }
  const boa = ex ? new Date(ex.em).getTime() : NaN;
  if (!Number.isNaN(boa) && agora.getTime() - boa > 2 * DIA) {
    return { nivel: "atencao", texto: `Banco sem atualizar há ${dias(Math.floor((agora.getTime() - boa) / DIA))}` };
  }
  const vencimentos = conexoes
    .map((c) => (c.consentimento_ate ? new Date(c.consentimento_ate).getTime() : NaN))
    .filter((t) => !Number.isNaN(t))
    .map((t) => Math.max(0, Math.floor((t - agora.getTime()) / DIA)));
  const menor = vencimentos.length ? Math.min(...vencimentos) : Infinity;
  if (menor <= 30) return { nivel: "atencao", texto: `Autorização do banco vence em ${dias(menor)}` };
  return { nivel: null, texto: "" };
}

const BRASILIA = "America/Sao_Paulo";
const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { timeZone: BRASILIA, hour: "2-digit", minute: "2-digit" });
const dia = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: BRASILIA, day: "2-digit", month: "2-digit", year: "numeric" });

const quando = (d: Date, agora: Date) => {
  if (dia(d) === dia(agora)) return `hoje às ${hora(d)}`;
  if (dia(d) === dia(new Date(agora.getTime() - DIA))) return `ontem às ${hora(d)}`;
  return `${dia(d).slice(0, 5)} às ${hora(d)}`;
};

const conexoesDe = (e: EstadoSync | null) => {
  const ex = e?.ultima_ok;
  return ex?.conexoes ?? (ex?.conexao ? [ex.conexao] : []);
};
const datas = (l: (string | null | undefined)[]) => l.map((x) => (x ? new Date(x) : null)).filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));

/**
 * Quando o Open Finance (MeuPluggy) leu os bancos pela última vez — a conexão mais antiga, que é a que limita
 * o que o app sabe — e a próxima renovação automática prevista (a mais cedo). O MeuPluggy renova uma vez por dia;
 * sincronizar no app só busca o que ele já tem.
 */
export function dadosDoBanco(e: EstadoSync | null): { em: Date; proxima: Date | null } | null {
  const c = conexoesDe(e);
  const lidas = datas(c.map((x) => x.atualizada_na_pluggy_em));
  if (!lidas.length) return null;
  const proximas = datas(c.map((x) => x.proxima_atualizacao_automatica));
  return {
    em: new Date(Math.min(...lidas.map((d) => d.getTime()))),
    proxima: proximas.length ? new Date(Math.min(...proximas.map((d) => d.getTime()))) : null,
  };
}

/** Dados do banco com mais de 30 horas: a renovação diária do Open Finance atrasou. */
export const DADOS_VELHOS_MS = 30 * 3600 * 1000;

/**
 * Texto de "atualizado" da barra do topo. Com banco, vale a hora em que o Open Finance leu os bancos
 * ("Dados do banco de ontem às 15:50"), que é a idade real do saldo; sem essa informação, a última
 * sincronização boa; sem banco, a hora em que os dados foram carregados.
 */
export function textoAtualizado(comBanco: boolean, e: EstadoSync | null, carregadoEm: Date | null, agora: Date = new Date()): string | null {
  if (comBanco) {
    const d = dadosDoBanco(e);
    if (d) return `Dados do banco de ${quando(d.em, agora)}`;
    const sinc = e?.ultima_ok?.em ? new Date(e.ultima_ok.em) : null;
    if (sinc && !Number.isNaN(sinc.getTime())) {
      if (dia(sinc) === dia(agora)) return `Atualizado às ${hora(sinc)}`;
      return `Banco atualizado ${dia(sinc).slice(0, 5)} às ${hora(sinc)}`;
    }
  }
  return carregadoEm ? `Atualizado às ${hora(carregadoEm)}` : null;
}

/** O que dizer depois de apertar Atualizar: a idade dos dados e quando o Open Finance renova de novo. */
export function mensagemDepoisDeAtualizar(e: EstadoSync | null, agora: Date = new Date()): string | null {
  const d = dadosDoBanco(e);
  if (!d) return null;
  let t = `Dados do banco de ${quando(d.em, agora)}.`;
  if (d.proxima) {
    t +=
      d.proxima.getTime() > agora.getTime()
        ? ` O Open Finance renova os dados uma vez por dia; próxima renovação prevista ${quando(d.proxima, agora)}.`
        : ` A renovação prevista ${quando(d.proxima, agora)} ainda não chegou; tente de novo em alguns minutos.`;
  }
  return t;
}
