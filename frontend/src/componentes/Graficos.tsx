import { useEffect, useState } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import type { VisaoGeral } from "../api";
import { data, MESES_CURTOS, mesAno, nomeCategoria, numero, reais, reaisCurto } from "../formato";
import { Vazio } from "./Indicador";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, Tooltip);

/** Lê as cores do tema atual e acompanha a troca claro/escuro. */
function useCores() {
  const ler = () => {
    const s = getComputedStyle(document.documentElement);
    const v = (n: string) => s.getPropertyValue(n).trim();
    return {
      s1: v("--s1"),
      s2: v("--s2"),
      s3: v("--s3"),
      s4: v("--s4"),
      s5: v("--s5"),
      s6: v("--s6"),
      ink: v("--ink"),
      ink2: v("--ink-2"),
      ink3: v("--ink-3"),
      line: v("--line"),
      surface: v("--surface"),
      accent: v("--accent"),
      good: v("--good"),
      bad: v("--bad"),
      /** Cores dos grupos: "g1".."g8" → valor do tema. */
      grupo: Object.fromEntries(["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8"].map((g) => [g, v(`--${g}`)])) as Record<string, string>,
    };
  };
  const [cores, setCores] = useState(ler);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const atualizar = () => setCores(ler());
    mq.addEventListener("change", atualizar);
    const mo = new MutationObserver(atualizar);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", atualizar);
      mo.disconnect();
    };
  }, []);
  return cores;
}

type Cores = ReturnType<typeof useCores>;

function opcoes(c: Cores, horizontal = false): ChartOptions<"bar" | "line"> {
  const eixoValor = { grid: { color: c.line }, border: { display: false }, ticks: { color: c.ink2, maxTicksLimit: 6, callback: (v: number | string) => reaisCurto(Number(v)) } };
  const eixoCategoria = { grid: { display: false }, border: { color: c.line }, ticks: { color: c.ink2, maxRotation: 0, autoSkip: true } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    indexAxis: horizontal ? "y" : "x",
    interaction: horizontal ? { mode: "nearest", axis: "y", intersect: false } : { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${reais(horizontal ? ctx.parsed.x : ctx.parsed.y)}` } },
    },
    scales: horizontal ? { x: eixoValor, y: eixoCategoria } : { x: eixoCategoria, y: eixoValor },
  } as ChartOptions<"bar" | "line">;
}

function Legenda({ itens }: { itens: [string, string][] }) {
  return (
    <div className="legend">
      {itens.map(([nome, cor]) => (
        <span key={nome}>
          <i style={{ background: cor }} />
          {nome}
        </span>
      ))}
    </div>
  );
}

const barra = { borderRadius: 4, borderSkipped: "start" as const, maxBarThickness: 22 };

export function GraficoFluxo({ v }: { v: VisaoGeral }) {
  const c = useCores();
  const s = v.serie_mensal;
  if (!s.some((p) => p.fluxo)) {
    return (
      <Vazio titulo={`Nenhuma movimentação em ${v.periodo.ano}`}>
        Envie extratos bancários. Cada lançamento é classificado e gravado em <code>movimentacoes.json</code>.
      </Vazio>
    );
  }
  return (
    <>
      <Legenda itens={[["Receitas", c.s1], ["Despesas + dívidas", c.s2]]} />
      <div className="chartbox">
        <Bar
          options={opcoes(c) as ChartOptions<"bar">}
          data={{
            labels: MESES_CURTOS,
            datasets: [
              { label: "Receitas", data: s.map((p) => p.fluxo?.receitas ?? null), backgroundColor: c.s1, ...barra },
              { label: "Despesas + dívidas", data: s.map((p) => (p.fluxo ? p.fluxo.despesas_consumo + p.fluxo.pagamento_dividas : null)), backgroundColor: c.s2, ...barra },
            ],
          }}
        />
      </div>
    </>
  );
}

export function GraficoPatrimonio({ v }: { v: VisaoGeral }) {
  const c = useCores();
  const s = v.serie_mensal;
  if (!s.some((p) => p.patrimonio !== null)) {
    return <Vazio titulo="Sem base para o patrimônio">Preciso de pelo menos um destes: saldo final das contas, posição de investimentos ou saldo devedor de dívidas.</Vazio>;
  }
  return (
    <div className="chartbox">
      <Line
        options={opcoes(c) as ChartOptions<"line">}
        data={{
          labels: MESES_CURTOS,
          datasets: [{ label: "Patrimônio líquido", data: s.map((p) => p.patrimonio), borderColor: c.s1, backgroundColor: c.s1 + "22", fill: true, borderWidth: 2, pointRadius: 3, tension: 0.25 }],
        }}
      />
    </div>
  );
}

export function GraficoCategorias({ v }: { v: VisaoGeral }) {
  const c = useCores();
  const cats = v.despesas_por_categoria;
  if (!cats.length) {
    return <Vazio titulo="Nenhuma despesa no período">As despesas aparecem por categoria (alimentação, moradia, transporte…) depois que o extrato for importado.</Vazio>;
  }
  const top = cats.slice(0, 8);
  if (cats.length > 8) top.push({ categoria: "outras", valor: cats.slice(8).reduce((a, x) => a + x.valor, 0) });
  return (
    <div className="chartbox">
      <Bar
        options={opcoes(c, true) as ChartOptions<"bar">}
        data={{ labels: top.map((x) => nomeCategoria(x.categoria)), datasets: [{ label: "Despesa", data: top.map((x) => x.valor), backgroundColor: c.s1, ...barra, maxBarThickness: 18 }] }}
      />
    </div>
  );
}

export function GraficoInvestimentos({ v }: { v: VisaoGeral }) {
  const c = useCores();
  const s = v.serie_mensal;
  if (!s.some((p) => p.investimentos)) {
    return (
      <Vazio titulo="Nenhum investimento cadastrado">
        Envie extratos da corretora ou informe aplicação, data e valor de cada aporte. Para CDI e Selic uso as séries oficiais do Banco Central.
      </Vazio>
    );
  }
  const o = opcoes(c) as ChartOptions<"bar">;
  (o.scales!.x as { stacked?: boolean }).stacked = true;
  (o.scales!.y as { stacked?: boolean }).stacked = true;
  return (
    <>
      <Legenda itens={[["Aportado", c.s1], ["Rendimento", c.s3]]} />
      <div className="chartbox">
        <Bar
          options={o}
          data={{
            labels: MESES_CURTOS,
            datasets: [
              { label: "Aportado", data: s.map((p) => p.investimentos?.aportado ?? null), backgroundColor: c.s1, stack: "a", maxBarThickness: 24 },
              { label: "Rendimento", data: s.map((p) => p.investimentos?.rendimento ?? null), backgroundColor: c.s3, stack: "a", borderRadius: 4, maxBarThickness: 24 },
            ],
          }}
        />
      </div>
    </>
  );
}

export function GraficoDividas({ v }: { v: VisaoGeral }) {
  const c = useCores();
  const l = v.dividas;
  if (!l.length) {
    return <Vazio titulo="Nenhuma dívida cadastrada">Envie o contrato ou o extrato do financiamento/empréstimo com saldo devedor, taxa e parcelas.</Vazio>;
  }
  const o = opcoes(c, true) as ChartOptions<"bar">;
  o.plugins!.tooltip!.callbacks = {
    label: (ctx) => {
      const d = l[ctx.dataIndex];
      return `${reais(ctx.parsed.x)} em ${data(d.data)}${d.taxa_mensal != null ? ` · ${numero(d.taxa_mensal)}% a.m.` : ""}`;
    },
  };
  return (
    <div className="chartbox">
      <Bar options={o} data={{ labels: l.map((d) => d.nome), datasets: [{ label: "Saldo devedor", data: l.map((d) => d.saldo), backgroundColor: c.s2, ...barra, maxBarThickness: 18 }] }} />
    </div>
  );
}

/** Cores das categorias de desconto do holerite, sempre na mesma ordem. */
export const GRUPOS_DESCONTO: [string, "s1" | "s2" | "s3" | "s4" | "s5" | "s6"][] = [
  ["INSS", "s1"],
  ["IRRF", "s6"],
  ["Vale-refeição", "s2"],
  ["Uniforme", "s3"],
  ["Contribuição sindical", "s4"],
  ["Outros", "s5"],
];

export function GraficoDescontos({ ano, porMes }: { ano: number; porMes: (Record<string, number> | null)[] }) {
  const c = useCores();
  if (!porMes.some(Boolean)) {
    return <Vazio titulo={`Nenhum holerite em ${ano}`}>Envie os holerites deste ano na aba Enviar para ver os descontos.</Vazio>;
  }
  const presentes = GRUPOS_DESCONTO.filter(([n]) => porMes.some((g) => g && g[n]));
  const o = opcoes(c) as ChartOptions<"bar">;
  (o.scales!.x as { stacked?: boolean }).stacked = true;
  (o.scales!.y as { stacked?: boolean }).stacked = true;
  return (
    <>
      <Legenda itens={presentes.map(([n, k]) => [n, c[k]])} />
      <div className="chartbox">
        <Bar
          options={o}
          data={{
            labels: MESES_CURTOS,
            datasets: presentes.map(([n, k], i) => ({
              label: n,
              data: porMes.map((g) => (g ? (g[n] ?? 0) : null)),
              backgroundColor: c[k],
              stack: "d",
              borderColor: c.surface,
              borderWidth: { top: i < presentes.length - 1 ? 2 : 0 },
              borderRadius: i === presentes.length - 1 ? 4 : 0,
              maxBarThickness: 28,
            })),
          }}
        />
      </div>
    </>
  );
}

export function GraficoParcelas({ meses }: { meses: [string, number][] }) {
  const c = useCores();
  if (!meses.length) {
    return <Vazio titulo="Nenhuma parcela futura">Quando houver compras parceladas, mostro aqui quanto de cada fatura já está ocupado.</Vazio>;
  }
  return (
    <div className="chartbox">
      <Bar
        options={opcoes(c) as ChartOptions<"bar">}
        data={{ labels: meses.map(([k]) => mesAno(k)), datasets: [{ label: "Parcelas", data: meses.map(([, v]) => v), backgroundColor: c.s2, ...barra, maxBarThickness: 28 }] }}
      />
    </div>
  );
}

/** Quanto foi gasto numa categoria em cada mês. */
export function GraficoCategoria({ meses, valores, media }: { meses: string[]; valores: number[]; media: number }) {
  const c = useCores();
  return (
    <div className="chartbox">
      <Bar
        options={opcoes(c) as ChartOptions<"bar">}
        data={{
          labels: meses.map((m) => mesAno(m)),
          datasets: [
            {
              label: "Gastou",
              data: valores,
              backgroundColor: valores.map((v) => (media > 0 && v > media * 1.2 ? c.s2 : c.s1)),
              ...barra,
              maxBarThickness: 32,
            },
          ],
        }}
      />
    </div>
  );
}

/** Saldo da reserva no fim de cada mês: uma série só, o título do quadro diz o que é. */
export function GraficoReserva({ meses }: { meses: { mes: string; saldo: number | null }[] }) {
  const c = useCores();
  const s = meses.filter((m) => m.saldo !== null);
  if (s.length < 2) {
    return <Vazio titulo="Pouco histórico">Com o saldo de pelo menos dois meses, mostro aqui como a reserva cresceu.</Vazio>;
  }
  return (
    <div className="chartbox">
      <Line
        options={opcoes(c) as ChartOptions<"line">}
        data={{
          labels: s.map((p) => mesAno(p.mes)),
          datasets: [{ label: "Saldo", data: s.map((p) => p.saldo), borderColor: c.s3, backgroundColor: c.s3 + "22", fill: true, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, cubicInterpolationMode: "monotone" }],
        }}
      />
    </div>
  );
}

// ---------- Análises ----------

/** Cor de um grupo ("g1".."g8") no tema atual; sem grupo, o cinza do texto fraco. */
export function corDoGrupo(c: Cores, cor: string | null | undefined): string {
  return (cor && c.grupo[cor]) || c.ink3;
}

/** Escreve um texto acima (ou abaixo, se negativa) de cada barra do primeiro conjunto de dados. */
function rotulosNasBarras(texto: (i: number) => string, cor: string): Plugin<"bar"> {
  return {
    id: "rotulosNasBarras",
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = cor;
      ctx.font = `600 ${chart.width < 420 ? 10 : 11}px ${ChartJS.defaults.font.family}`;
      ctx.textAlign = "center";
      chart.getDatasetMeta(0).data.forEach((el, i) => {
        const t = texto(i);
        if (!t) return;
        const { x, y, base } = el.getProps(["x", "y", "base"], true) as { x: number; y: number; base: number };
        ctx.textBaseline = "bottom";
        ctx.fillText(t, x, Math.min(y, base) - 4);
      });
      ctx.restore();
    },
  };
}

/** "Contas fixas que faltam" → ["Contas", "fixas que", "faltam"]: linhas curtas embaixo da barra (cabem no celular). */
const emLinhas = (nome: string, max = 10) =>
  nome.split(" ").reduce<string[]>((l, p) => {
    const ult = l[l.length - 1];
    if (ult !== undefined && ult.length + 1 + p.length <= max) l[l.length - 1] = `${ult} ${p}`;
    else l.push(p);
    return l;
  }, []);

/**
 * Cascata da previsão do fim do mês: a primeira barra é o que sobrou até hoje, cada passo seguinte
 * desce (ou sobe) a partir de onde o anterior parou e a última, "Fim do mês", sai do zero.
 */
export function GraficoCascata({ passos, fim }: { passos: { nome: string; valor: number }[]; fim: number }) {
  const c = useCores();
  const barras = [...passos, { nome: "Fim do mês", valor: fim }];
  let acumulado = 0;
  const faixas = barras.map((b, i): [number, number] => {
    if (i === barras.length - 1) return [0, b.valor];
    const ini = i === 0 ? 0 : acumulado;
    acumulado = ini + b.valor;
    return [ini, acumulado];
  });
  const cores = barras.map((b, i) => (i === 0 || i === barras.length - 1 ? (b.valor >= 0 ? c.good : c.bad) : c.ink3 + "8c"));
  const o = opcoes(c) as ChartOptions<"bar">;
  o.layout = { padding: { top: 18 } };
  o.interaction = { mode: "nearest", intersect: true };
  (o.scales!.y as { beginAtZero?: boolean }).beginAtZero = true;
  o.plugins!.tooltip!.callbacks = { label: (ctx) => reais(barras[ctx.dataIndex].valor) };
  (o.scales!.x as { ticks: object }).ticks = { color: c.ink2, maxRotation: 0, autoSkip: false, font: { size: 10.5 } };
  return (
    <div className="chartbox an-cascata">
      <Bar
        options={o}
        plugins={[rotulosNasBarras((i) => reaisCurto(Math.abs(barras[i].valor) < 0.5 ? 0 : barras[i].valor), c.ink2)]}
        data={{
          labels: barras.map((b) => emLinhas(b.nome)),
          datasets: [{ label: "Previsão", data: faixas, backgroundColor: cores, borderRadius: 4, borderSkipped: false, maxBarThickness: 56 }],
        }}
      />
    </div>
  );
}

/** Parcelas já marcadas em cada uma das próximas faturas. */
export function GraficoFuturas({ futuras }: { futuras: { mes: string; valor: number }[] }) {
  const c = useCores();
  const o = opcoes(c) as ChartOptions<"bar">;
  o.layout = { padding: { top: 18 } };
  o.plugins!.tooltip!.callbacks = { label: (ctx) => reais(ctx.parsed.y) };
  return (
    <div className="chartbox an-baixo">
      <Bar
        options={o}
        plugins={[rotulosNasBarras((i) => reaisCurto(futuras[i].valor), c.ink2)]}
        data={{ labels: futuras.map((f) => mesAno(f.mes)), datasets: [{ label: "Parcelas", data: futuras.map((f) => f.valor), backgroundColor: c.accent + "cc", ...barra, maxBarThickness: 32 }] }}
      />
    </div>
  );
}

/** Quanto sobrou (verde) ou faltou (vermelho) em cada mês; o mês que não acabou leva "*". */
export function GraficoSobra({ meses }: { meses: { mes: string; sobra: number; parcial: boolean }[] }) {
  const c = useCores();
  const o = opcoes(c) as ChartOptions<"bar">;
  o.plugins!.tooltip!.callbacks = { label: (ctx) => `${meses[ctx.dataIndex].sobra >= 0 ? "Sobrou" : "Faltou"}: ${reais(Math.abs(meses[ctx.dataIndex].sobra))}` };
  return (
    <div className="chartbox an-medio">
      <Bar
        options={o}
        data={{
          labels: meses.map((m) => `${mesAno(m.mes)}${m.parcial ? "*" : ""}`),
          datasets: [{ label: "Sobra", data: meses.map((m) => m.sobra), backgroundColor: meses.map((m) => (m.sobra >= 0 ? c.good : c.bad)), borderRadius: 4, borderSkipped: false, maxBarThickness: 36 }],
        }}
      />
    </div>
  );
}

/** Gasto de cada grupo no mês (barra na cor do grupo) com um traço na média dos meses anteriores. */
export function GraficoAcimaDaMedia({ linhas }: { linhas: { nome: string; cor: string | null; mes: number; media: number }[] }) {
  const c = useCores();
  const o = opcoes(c, true) as ChartOptions<"bar">;
  o.plugins!.tooltip!.callbacks = { label: (ctx) => [`Neste mês: ${reais(linhas[ctx.dataIndex].mes)}`, `Média: ${reais(linhas[ctx.dataIndex].media)}`] };
  (o.scales!.x as { suggestedMax?: number }).suggestedMax = Math.max(...linhas.map((l) => l.media)) * 1.05;
  const traco: Plugin<"bar"> = {
    id: "tracoDaMedia",
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const x = chart.scales.x;
      ctx.save();
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 2;
      chart.getDatasetMeta(0).data.forEach((el, i) => {
        const m = linhas[i]?.media;
        if (!(m > 0)) return;
        const { y, height } = el.getProps(["y", "height"], true) as { y: number; height: number };
        const px = x.getPixelForValue(m);
        ctx.beginPath();
        ctx.moveTo(px, y - height / 2 - 4);
        ctx.lineTo(px, y + height / 2 + 4);
        ctx.stroke();
      });
      ctx.restore();
    },
  };
  return (
    <div className="chartbox" style={{ height: 40 + linhas.length * 36 }}>
      <Bar
        options={o}
        plugins={[traco]}
        data={{
          labels: linhas.map((l) => l.nome),
          datasets: [{ label: "Neste mês", data: linhas.map((l) => l.mes), backgroundColor: linhas.map((l) => corDoGrupo(c, l.cor)), ...barra, maxBarThickness: 18 }],
        }}
      />
    </div>
  );
}

/** Patrimônio no fim de cada mês do período, em linha com área. */
export function GraficoPatrimonioPeriodo({ pontos }: { pontos: { mes: string; valor: number }[] }) {
  const c = useCores();
  const o = opcoes(c) as ChartOptions<"line">;
  o.plugins!.tooltip!.callbacks = { label: (ctx) => reais(ctx.parsed.y) };
  return (
    <div className="chartbox an-medio">
      <Line
        options={o}
        data={{
          labels: pontos.map((p) => mesAno(p.mes)),
          datasets: [{ label: "Patrimônio", data: pontos.map((p) => p.valor), borderColor: c.accent, backgroundColor: c.accent + "1f", fill: true, borderWidth: 2.4, pointRadius: 3, pointHoverRadius: 5, tension: 0.25 }],
        }}
      />
    </div>
  );
}
