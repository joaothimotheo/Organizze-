# Origem de cada lançamento na lista de Movimentos — design curto

Data: 22/11/2026 · Branch: `v4` · Status: aguardando aprovação

## Por quê
Na lista de Movimentos o usuário não distingue de relance o que foi no cartão de crédito, no débito (conta corrente) e no Mercado Pago (reserva): hoje a conta é só texto cinza pequeno misturado com a descrição do banco.

## Objetivo
Cada lançamento da lista mostra uma etiqueta com cor e nome da origem, e o topo da lista tem atalhos de filtro por origem.

## Fora do escopo
Início, totais por origem, detalhe do lançamento e modo rápido (podem reaproveitar a etiqueta depois). Nada muda no servidor nem nos dados.

## Abordagens
A (escolhida): etiqueta colorida em cada linha + atalhos de filtro. B (faixa colorida na borda): depende só de cor e de legenda. C (blocos por origem): quebra o agrupamento por dia, que o usuário pediu para manter.

## Design
- **Origem de um lançamento** (função pura nova, `frontend/src/movimentos.ts`), a partir de `brutos.contas` e `m.conta_id`:
  - conta com `papel: "reserva"` → **reserva**, rótulo = `instituicao` da conta (ex.: "Mercado Pago"; sem instituição: "Reserva");
  - conta `tipo` cartão/crédito → **crédito**, rótulo "Crédito" (com mais de um cartão: "Crédito <instituição>");
  - outra conta do banco → **débito**, rótulo "Débito" (com mais de uma conta corrente: "Débito <instituição>");
  - `conta_id` ausente ou "dinheiro" → **dinheiro**, rótulo "Dinheiro".
  O "Débito" inclui Pix e boleto que saem da conta corrente (aceito pelo usuário).
- **Etiqueta na linha:** pílula pequena no começo da segunda linha (antes de "descrição · parcela"), com o nome da conta completo no `title`/leitor de tela ("Cartão Santander final 1234"). Texto sempre visível, não só cor.
- **Cores** *(minha)*: tokens novos no CSS, com versão clara e escura: crédito = violeta, débito = verde-azulado do app (`--accent`), reserva = azul, dinheiro = cinza (`--ink-3`). Fundo suave + texto escuro do mesmo tom, contraste AA.
- **Atalhos no topo:** "Todos · Crédito · Débito · Mercado Pago · Dinheiro" (só as origens que existem nos dados; rótulos iguais aos das etiquetas), logo acima da lista; um toque filtra, outro toque (ou "Todos") limpa. Convive com o filtro por conta que já existe em "Filtros" (os dois se somam). *(minha)*
- Celular: a etiqueta cabe na segunda linha; atalhos rolam na horizontal se não couberem.

## Fica com o construtor
Nomes, classes CSS e os tons exatos (dentro do pedido acima); testes da função de origem (reserva, crédito, débito, dinheiro, dois cartões, conta sem tipo).
