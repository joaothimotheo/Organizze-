# Remodelagem Fase 5 – Análises e Início Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela Análises com seis perguntas respondidas em uma frase antes de cada gráfico, e um Início novo, curto, que mostra como está o mês e leva às outras telas.

**Architecture:** Só front. `frontend/src/analises.ts` (puro, testado em Node) calcula as respostas a partir de `brutos`, da `visao` do servidor e de `hoje`; `paginas/Analises.tsx` desenha as seis perguntas com os gráficos (`componentes/Graficos.tsx`, chart.js, já usado no app); `paginas/VisaoGeral.tsx` vira o Início novo. O menu ganha Análises.

**Tech Stack:** React 18 + TypeScript 5.5 + Vite; chart.js/react-chartjs-2 (já no projeto); testes Node (`npm run teste`).

**Spec:** `docs/superpowers/specs/2026-11-19-remodelagem-design.md` (seção 5 e a parte de menu da seção 1). Protótipo: `docs/prototipos/2026-11-19-remodelagem.html` (telas Início e Análises: `telaInicio`, `telaAnalises`, `previsao`, `cartao`, `svgCascata`, `svgFuturas`). Depende das fases 1-4 (publicadas).

## Global Constraints

- Branch `v4`. Publicar só com o OK do usuário.
- Menu: Análises entra no menu lateral depois de Objetivos (`MENU_PRINCIPAL`) e em Mais logo depois de Dívidas (`MENU_MAIS`); endereço `#analises`. No celular, `abaDoCelular("analises")` = "mais".
- Período das Análises: chips "3 meses" e "6 meses" (padrão 6), contando para trás a partir do mês escolhido na barra do topo (inclusive). Preferência em `localStorage` `tf-analises` = `3` | `6`.
- Totais seguem as regras das fases 2 e 3: gasto = `despesa` (por parte, `partesDe`), entrada = `receita` + `estorno`, as naturezas que não contam ficam fora; competência = `competencia ?? data[0:7]`.
- As seis perguntas, nesta ordem, cada uma com a resposta numa frase antes do gráfico:
  1. **Vou fechar o mês no azul?** Só para o mês atual: sobrou até hoje − parcelas de dívida ainda não pagas no mês (dívidas cadastradas com próxima parcela neste mês, de `dividas.ts`) − contas fixas ativas ainda não pagas no mês − dia a dia previsto (média diária dos gastos do mês até hoje que não são de contas fixas × dias que faltam) + entradas previstas (nenhuma; dizer "Nenhuma entrada prevista até o fim do mês."). Frase: "Sim. Deve sobrar cerca de R$ X em dd/mm." ou "Não. Deve faltar cerca de R$ X em dd/mm.". Gráfico em cascata (barras: Sobrou até hoje, Parcelas que faltam, Contas fixas que faltam, Dia a dia até o fim do mês, Fim do mês). Para mês passado: "Fechou com sobra de R$ X." / "Fechou faltando R$ X." sem cascata.
  2. **Para onde vai o cartão?** Fatura em aberto de cada cartão (contas de cartão em `brutos.contas`; lançamentos de competência = a mais recente com lançamentos, se ≥ mês atual) por grupo (por parte), com "Parcelas" (lançamentos com `parcela`) e "Sem categoria" separados; frase "A fatura de <mês> está em R$ X. <Grupo> é o que mais pesa, fora as parcelas."; barras horizontais; abaixo, "Já marcado nas próximas faturas" com os próximos 6 meses de parcelas (de `parcelasCartao`) e a frase "Até <mês>, R$ X de cada fatura já estão ocupados por parcelas." (quando o valor mensal se repete) ou "R$ X na próxima fatura.".
  3. **Está sobrando dinheiro?** Por mês do período: entrou − saiu (de `visao.ultimos_meses`); frase "Sobrou em N de M meses. Média de R$ X por mês."; barras verdes (sobrou) e vermelhas (faltou); mês atual marcado "* ainda não acabou".
  4. **Onde gastei mais que o normal?** Gasto de cada grupo no mês escolhido contra a média dos meses anteriores do período (que tiveram gasto); frase "<Grupo> passou R$ X da sua média." para o maior excesso, ou "Nenhum grupo passou da média." ; barras horizontais com um traço na média.
  5. **Meu patrimônio está crescendo?** Patrimônio no fim de cada mês do período (de `visao.ultimos_meses`, campo de patrimônio do ponto mensal; meses sem dado não entram); frase "Sim. Subiu R$ X em N meses." / "Não. Caiu R$ X em N meses." e, se negativo, "Ainda negativo (R$ X), mas melhorando." quando subiu; linha com área.
  6. **De onde vem o meu dinheiro?** Entradas do mês por origem (grupos de entrada; antes de migrar, por categoria) por parte; frase "O salário é N% do que entrou em <mês>." (ou o maior grupo quando não há salário); barras; aviso âmbar quando há entradas sem origem, com link para `#movimentos/pendentes`.
- Sem dados suficientes para uma pergunta: a frase diz o que falta ("Ainda não há meses suficientes para comparar.") e o gráfico não aparece.
- Início novo (modo completo, fonte banco), de cima para baixo:
  - Aviso de pendentes (o mesmo das fases anteriores) e o aviso de migrar categorias enquanto não migrado.
  - Linha "Agora" que já existe (saldo na conta, reserva, fatura aberta, patrimônio) — mantida, compacta.
  - "Sobrou até agora" do mês escolhido: valor grande, entrou e saiu, barra de quanto do que entrou já saiu, nota "Transferências entre suas contas e pagamento de dívidas não entram aqui.".
  - "Para onde foi o dinheiro": os 5 maiores grupos do mês (por parte), cada um leva a `#movimentos/<grupo>`; link "Ver gastos".
  - "De onde veio": origens do mês; "Sem origem ainda" quando houver; link "Ver entradas".
  - "Próximas contas": as 3 próximas entre contas fixas não pagas e parcelas de dívidas cadastradas, com data e valor; link "Contas fixas".
  - "Reserva de emergência": saldo, meta (a meta com `usar_reserva`), % e a frase "Guardando R$ X por mês, chega lá em <mês/ano>." usando a sobra média (`plano.ts` `sobraMedia`) quando positiva; link "Objetivos".
  - Cartão "Análise do mês" com a frase da pergunta 1 (ou da 3 em mês passado) que leva a `#analises`.
- Saem do Início: a lista de Lançamentos (está em Movimentos), os gráficos "Entrou e saiu nos últimos 12 meses" e "Patrimônio no fim de cada mês" (vão para Análises) e o painel "Dívidas, investimentos e metas" (está em Dívidas e Objetivos). Modo simples (`Simples.tsx`) e fonte documentos (`VisaoGeralAntiga.tsx`) não mudam.
- Textos em português do Brasil; valores em R$ com vírgula; datas dd/mm/aaaa; nenhuma cor solta (cores dos grupos `--g1..--g8`; verde/vermelho = `--good`/`--bad`).

## Review Focus

- Mês sem nenhum lançamento: Início e Análises mostram frases de vazio, sem NaN e sem divisão por zero.
- Usuário que ainda não migrou categorias: "Para onde foi", pergunta 4 e pergunta 6 usam as categorias antigas com os nomes de `nomeCategoria`.
- Mês passado escolhido na barra do topo: pergunta 1 vira "Fechou com…", e o Início mostra "Sobrou no mês" em vez de "Sobrou até agora".
- Conta fixa ligada a um lançamento (fase 3, marcada paga) não entra em "contas fixas que faltam".
- Lançamento dividido conta cada parte no seu grupo em todas as somas.

---

### Task 1: Lógica das análises (`analises.ts`)

**Files:**
- Create: `frontend/src/analises.ts`, `frontend/testes/analises.teste.ts`

**Interfaces:**
- Produces:
  - `type Periodo = 3 | 6`; `mesesDoPeriodo(fim: string /* AAAA-MM */, n: Periodo): string[]`
  - `totaisDoMes(movs: Movimentacao[], mes: string, ateDia?: string): { entrou: number; saiu: number; sobra: number }`
  - `fechamento(b: Brutos, mes: string, hoje: string): { atual: boolean; sobrouAteHoje: number; parcelas: number; fixas: { nome: string; dia: string; valor: number }[]; diaADia: number; fim: number; passos: { nome: string; valor: number }[] }`
  - `faturaCartao(b: Brutos, hoje: string): { mes: string; total: number; linhas: { nome: string; cor: string | null; valor: number }[]; futuras: { mes: string; valor: number }[] } | null`
  - `sobraPorMes(v: VisaoGeral, meses: string[]): { mes: string; sobra: number; parcial: boolean }[]`
  - `acimaDaMedia(movs: Movimentacao[], grupos: Grupo[] | CategoriaInfo[], meses: string[]): { grupo: string; nome: string; cor: string | null; mes: number; media: number }[]` (último de `meses` = mês avaliado)
  - `patrimonioPorMes(v: VisaoGeral, meses: string[]): { mes: string; valor: number }[]`
  - `origens(movs: Movimentacao[], grupos: Grupo[] | CategoriaInfo[], mes: string): { grupo: string; nome: string; cor: string | null; valor: number }[]` e `semOrigem(movs, mes): number`
  - `frases`: `fraseFechamento`, `fraseCartao`, `fraseSobra`, `fraseAcima`, `frasePatrimonio`, `fraseOrigem` — cada uma `(resultado) => string`, com os textos das Global Constraints
  - `proximasContas(b: Brutos, hoje: string, n = 3): { nome: string; data: string; valor: number; tipo: "fixa" | "divida" }[]`
  - `reservaResumo(b: Brutos, saldo: number | null, hoje: string): { saldo: number; meta: number | null; pct: number | null; frase: string | null } | null`
- [ ] **Step 1: Testes** com um conjunto de exemplo de 7 meses (entradas, gastos com e sem partes, transferência interna, pagamento de dívida, fixa paga e não paga, cartão com parcelas, holerites): números de cada função e as frases exatas (incluindo os casos de vazio e de mês passado). **Step 2:** RED. **Step 3:** implementar (reusar `partesDe`, `ehGasto`, `ehEntrada`, `naoConta` de `grupos.ts`/`movimentos.ts`, `parcelasCartao` e `juntarDividas` de `dividas.ts`, `sobraMedia` de `plano.ts`, `nomeCategoria` de `formato.ts`). **Step 4:** GREEN (`npm run teste && npm run build`). **Step 5:** commit "Lógica das análises: fechamento do mês, cartão, sobra, média, patrimônio e origens".

### Task 2: Tela Análises e menu

**Files:**
- Create: `frontend/src/paginas/Analises.tsx`
- Modify: `frontend/src/navegacao.ts` (+ testes: `analises` em `Tela`, menus, `abaDoCelular`), `frontend/src/App.tsx` (rota), `frontend/src/paginas/Mais.tsx` (descrição "Gráficos que respondem uma pergunta cada"), `frontend/src/componentes/Graficos.tsx` (gráficos novos: cascata, barras horizontais com média, barras de sobra; reusar `useCores`/`opcoes`), `frontend/src/estilo.css`

**Interfaces:**
- Consumes: Task 1.
- Produces: `Analises({ brutos, visao, ano, mes })` com os chips de período e as seis perguntas em cartões de duas colunas no computador e uma no celular; cada cartão: rótulo da pergunta (maiúsculas pequenas), frase-resposta (com o destaque nos números), gráfico, legenda curta.
- [ ] **Step 1: Implementar.** **Step 2: Verificar** — `npm run teste && npm run build`; no app local com dados de exemplo. **Step 3: Commit** "Tela Análises com seis perguntas e Análises no menu".

### Task 3: Início novo

**Files:**
- Modify: `frontend/src/paginas/VisaoGeral.tsx` (reescrever a parte de banco, mantendo `situacaoAgora`/`Agora` e o que `Simples.tsx` importa daqui), `frontend/src/estilo.css`

**Interfaces:**
- Consumes: Task 1 (`totaisDoMes`, `origens`, `semOrigem`, `proximasContas`, `reservaResumo`, `fechamento`, frases), `QuadroReserva`/`saldoReserva` se útil.
- Produces: o Início das Global Constraints. Nada que hoje é importado de `VisaoGeral.tsx` por outro arquivo pode sumir (grep antes).
- [ ] **Step 1: Implementar.** **Step 2: Verificar** — `npm run teste && npm run build`; app local. **Step 3: Commit** "Início novo: como está o mês, para onde foi, de onde veio, próximas contas e reserva".
