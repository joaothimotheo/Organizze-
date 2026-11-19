# Remodelagem do Financeiro (V4)

Protótipo aprovado: `docs/prototipos/2026-11-19-remodelagem.html` (publicado em https://claude.ai/artifact/GeREFBhejLrWgXdASxi55F, versão 6).
Decisões tomadas com o usuário em 19/11/2026, tela por tela.

## Objetivo

Manter a base do V3 (Rust/axum + React/Vite, dados JSON no Neon, sincronização MeuPluggy) e refazer a forma de usar:
menos categorias e criadas pelo usuário, entradas com origem, menus mais curtos, dívidas por tipo e análises que respondem perguntas.

## Fases (cada uma vai para produção sozinha)

| Fase | Entrega | Plano |
|---|---|---|
| 1 | Navegação: menu lateral recolhível, barra de baixo com +, barra fixa no topo, tela Mais, lançamento manual | `plans/2026-11-19-remodelagem-fase1-navegacao.md` |
| 2 | Categorias: grupos criados pelo usuário, origens de entrada, migração, sugestões | `plans/2026-11-19-remodelagem-fase2-categorias.md` |
| 3 | Movimentos: entradas e saídas numa tela, busca e filtros, modo rápido, detalhes (renomear, dividir, ligar) | a escrever ao fim da fase 2 |
| 4 | Dívidas: tipos próprios, confirmação de pagamento, juros que faltam, peso no mês, simulador, histórico | a escrever |
| 5 | Análises (6 perguntas) e Início novo | a escrever |

A fase 3 depende da 2 (usa os grupos). As fases 4 e 5 dependem da 1 e podem ir em qualquer ordem depois da 3.

## 1. Navegação

- **Computador** (largura ≥ 760 px): menu lateral à esquerda.
  - Topo: botão **Lançar**; depois Início, Movimentos, Dívidas, Objetivos, Análises.
  - Grupo "Organizar": Contas fixas, Pessoas.
  - Fim: Categorias, Salários, Ajustes.
  - Botão para recolher (só ícones, 72 px); preferência em `localStorage` `tf-menu` = `recolhido` | `aberto`.
- **Celular** (< 760 px): barra de baixo com Início, Movimentos, **+** (redondo, no meio), Objetivos, Mais.
  - Mais lista, nesta ordem: Dívidas, Análises, Contas fixas, Pessoas, Categorias, Ajustes, Salários.
- **Barra do topo** igual em todas as telas: seletor de mês (‹ Novembro 2026 ›, tocar no nome abre a lista com "Ano inteiro"), aviso de pendentes (contagem de lançamentos sem categoria no mês; no celular só o número), atualizar bancos (mostra "Atualizado às HH:MM" no computador) e esconder valores.
- O **+** abre: Lançar um gasto, Lançar uma entrada, Organizar pendentes (N).
- Lançar manual: valor, descrição, pago com (Dinheiro, ou uma das contas sincronizadas), data (padrão hoje); depois abre a escolha de categoria.
- Endereços: `#inicio` (antigo `#visao`), `#movimentos` (antigo `#gastos`), `#dividas`, `#objetivos`, `#analises`, `#fixas`, `#pessoas`, `#categorias`, `#salarios`, `#ajustes`, `#mais`. Endereços antigos redirecionam.
- Saem do cabeçalho: Simples | Completo (vai para Ajustes), Sair (vai para Ajustes), Ano/Mês em selects.

## 2. Categorias

- Gastos: o sistema traz só **Outros gastos** (padrão, não apaga). O usuário cria os grupos (nome, cor entre 8, detalhes opcionais).
- Detalhe (subcategoria) é opcional.
- Entradas, padrão e não apagáveis: Salário, Renda extra, Pix de pessoas, Rendimentos e estornos (detalhes Rendimentos, Estorno, Venda), Outras entradas. O usuário pode criar mais origens.
- Entradas guardam "quem mandou" (opcional). Gastos do grupo que o usuário marcar como "pede pessoa" (ex.: Pix para pessoas) guardam "para quem".
- **Não contam no mês** (vêm da `natureza`, não de categoria):
  - Saídas: Entre minhas contas (`transferencia_interna`), Guardei ou investi (`aporte_investimento`), Paguei uma dívida (`pagamento_divida`), Emprestei para alguém (`emprestimo_concedido`, novo).
  - Entradas: Entre minhas contas (`transferencia_interna`), Me devolveram (`emprestimo_devolvido`, novo), Peguei emprestado (`emprestimo_recebido`), Tirei da reserva (`resgate_investimento`).
- Estorno passa a contar como **entrada** (origem Rendimentos e estornos), não mais abatendo o gasto.
- **Sugestões:** quando 3 ou mais lançamentos dos últimos 3 meses em Outros gastos têm o mesmo detalhe, aparece "Criar <detalhe>?". Criar leva esses lançamentos junto.
- Apagar um grupo: os lançamentos vão para Outros gastos (ou Outras entradas), com o nome do grupo apagado como detalhe.
- **Migração (uma vez):** tela lista as categorias de gasto de hoje com o uso em 12 meses; já marcadas as com 15 usos ou mais. Marcada vira grupo com o mesmo nome. Desmarcada vai para Outros gastos com o nome antigo como detalhe. "Pix no cartão" nunca vira grupo: vai para Outros gastos com detalhe "Pix no cartão". Receitas: `salario` → Salário, `outras_receitas` → Outras entradas, receita de `investimentos` → Rendimentos e estornos. Nada é apagado; o arquivo antigo fica nas versões do Neon.
- A classificação automática continua: as regras por palavra-chave apontam para as chaves antigas, e o mapa da migração diz para qual grupo cada chave foi; sem grupo, vai para "sem categoria".

## 3. Movimentos

- Abas Entradas | Saídas | Tudo, resumo por origem/grupo no topo (toque filtra).
- Busca sempre visível (nome, descrição do banco, pessoa, conta; sem diferenciar acento). Botão Filtros abre conta e valor (acima de 50, 100, 500).
- Lista por dia, mais recente primeiro.
- Botão de categoria em cada linha (troca rápida). Toque no nome abre os detalhes: renomear, categoria, dividir em partes (soma tem que fechar com o total), ligar a dívida, pessoa ou conta fixa.
- **Modo rápido:** um pendente por vez, "N de M"; um toque salva e avança; Pular; resumo no fim. "Lembrar para os próximos iguais" sempre ligado.

## 4. Dívidas

- Tipos padrão: Cartão parcelado, Empréstimos, Com pessoas. "+ Novo tipo" cria outros.
- Topo: Você deve, Juros que faltam (pagando só as parcelas), Peso no mês (parcelas ÷ salário líquido médio; barra âmbar acima de 30%), Livre das parcelas (mês da última parcela).
- Pagamento parecido com parcela no banco gera aviso "É a parcela X de Y de <dívida>?" com Sim, é | Não é. Só baixa com confirmação.
- Cada dívida: etiqueta (Juros altos ≥ 3% ao mês, Sem juros, Em atraso), barra de progresso, próxima parcela e data; aberta mostra para quitar hoje, pagando até o fim, juros que faltam e a lista de pagamentos.
- "E se eu adiantar?": valor vai para a dívida de maior juro; mostra juros economizados e meses a menos (amortização Price, parcela fixa).
- Ordem sugerida: maior juro, depois atrasadas, depois sem juros.

## 5. Análises e Início

- Análises, período 6 meses (opção 3): Vou fechar o mês no azul?, Para onde vai o cartão?, Está sobrando dinheiro?, Onde gastei mais que o normal?, Meu patrimônio está crescendo?, De onde vem o meu dinheiro? Cada uma com a resposta escrita antes do gráfico.
- Início: aviso de pendentes, Sobrou até agora (entrou, saiu), Para onde foi, De onde veio, Próximas contas, Reserva de emergência, atalho para a análise do mês.
- Objetivos: sem mudança de conteúdo.

## Fora do escopo

- Mudar a sincronização Pluggy, o login ou o armazenamento.
- Mudar Objetivos, Contas fixas, Pessoas e Salários além de mudar de lugar no menu.
