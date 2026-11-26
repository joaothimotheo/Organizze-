# Financeiro · Modelo de dados (schema v1)

Fonte única de verdade: os arquivos JSON da pasta de dados (`dados/`, configurável por `FINANCEIRO_DADOS`). O back-end lê esses arquivos e calcula os indicadores. Nada aqui é preenchido com valores inventados.

## Convenções gerais

- Valores em reais, número decimal com ponto (`1234.56`). Saídas de conta são **negativas** em `movimentacoes`.
- Datas `AAAA-MM-DD`; competência `AAAA-MM`.
- Todo registro tem `id` estável e `status`: `confirmado` (lido de documento), `estimado` (calculado/premissa) ou `pendente` (falta confirmar).
- Rastreabilidade: `origem = {"documento_id": "...", "pagina": 1, "linha": 12}` aponta para `documentos.json`.
- Antes de importar, calcula-se o SHA-256 do arquivo; se já existir em `documentos.json`, não reprocessa.
- Documentos originais ficam em `documentos/AAAA-MM/` (fora do Git) (recomenda-se ocultar CPF e números completos de conta).

## Arquivos

### config.json
`titular`, `moeda`, `fuso`, `contas: [{id, instituicao, tipo: corrente|poupanca|investimento|cartao, apelido, final}]` (`final` = últimos 4 dígitos, nunca o número completo).

### holerites.json → `holerites[]`
```
{id, competencia, empregador, data_pagamento,
 tipo: mensal|adiantamento|ferias|13_1|13_2|plr|rescisao,
 proventos: [{codigo, descricao, referencia, valor, recorrente: bool,
              natureza: salario|hora_extra|adicional|comissao|ferias|13|outros}],
 descontos: [{codigo, descricao, valor, tipo: inss|irrf|vt|plano_saude|consignado|adiantamento|outros}],
 bruto, total_descontos, liquido, base_inss, base_irrf, fgts,
 origem, status}
```
O líquido é referência de renda. O crédito correspondente no extrato é conciliado (`conciliado_com`), nunca somado de novo.

### movimentacoes.json → `movimentacoes[]` e `saldos[]`
```
movimentacoes: {id, conta_id, data, descricao, valor,
  natureza: receita|despesa|transferencia_interna|aporte_investimento|resgate_investimento|pagamento_divida|estorno,
  categoria: alimentacao|transporte|moradia|lazer|maquinas_ursinho|saude|educacao|assinaturas|compras|servicos|impostos|outros|...|p_<sua>,
  recorrencia: fixa|variavel|eventual,
  conciliado_com: {tipo: holerite|divida|investimento|movimentacao, id} | null,
  hash, origem, status}
saldos: {conta_id, competencia, saldo_inicial, saldo_final, origem, status}
```
`hash` = conta + data + valor + descrição normalizada, para detectar duplicatas.

Contas em `config.json → contas[]` podem ter `papel: "reserva"` (reserva de emergência): o saldo aparece à parte do "saldo na conta", mas entra no patrimônio. Conta corrente nova do Mercado Pago já nasce como reserva; dá para mudar em Enviar → Suas contas (`PATCH /api/contas/:id {papel}`).

Transferência entre contas suas: na sincronização, o mesmo valor saindo de uma conta corrente e entrando em outra em até 2 dias vira `natureza = transferencia_interna` nos dois lados (categoria `transferencias`, subcategoria "entre suas contas", `conciliado_com` apontando para o par). Não mexe no que foi classificado à mão.

`PLUGGY_ITEM_ID` aceita mais de uma conexão MeuPluggy, separadas por vírgula (ex.: Santander e Mercado Pago). Pelo MeuPluggy o conector se chama "MeuPluggy"; o banco é reconhecido pelo nome da conta.

Lançamentos vindos do banco (Pluggy) têm `id = "pluggy-<id>"` e `origem = {"fonte": "pluggy", "pluggy_id", "pluggy_conta", "categoria_pluggy"}` (sem `documento_id`). Natureza extra: `emprestimo_recebido` (crédito de empréstimo, fora dos totais). Contas vinculadas ganham `pluggy_id` em `config.json`.

### categorias.json → `categorias[]`
Categorias criadas por você: `{id, nome, criada_em}`. O `id` começa com `p_` (ex.: `p_pet`) para nunca colidir com uma categoria fixa. O nome tem até 40 letras e não pode repetir outro, fixo ou seu (sem diferenciar maiúsculas).

`ocultas[]`: ids das categorias fixas que você excluiu. Elas somem das listas de escolha e o classificador (regras, o que aprendeu e a categoria da Pluggy) não as escolhe mais; dá para restaurar. Não podem ser excluídas: `a_classificar`, `outros`, `salario`, `outras_receitas`, `transferencias`, `transferencias_pix`, `investimentos`, `emprestimos`, `pagamento_fatura_cartao`.

Ao excluir uma categoria (sua ou fixa), os lançamentos dela vão para a categoria escolhida (`DELETE /api/categorias/:id?para=…`, padrão `a_classificar`) e ficam como classificação `manual` (ou `baixa`, se forem para `a_classificar`).

Regra fixa `VMT` → `maquinas_ursinho` (máquinas de pegar ursinho): descrições como `VMT*LOJA`, `VMT.LOJA` e `LOJA.VMT.X`. Na partida do servidor, os lançamentos já gravados que batem com essa regra são corrigidos, menos os que você classificou à mão.

**Modelo por documentos** (`?fonte=documentos` em `/api/visao-geral` e `/api/dados/movimentacoes|dividas`): a resposta deixa de fora o que tem `origem.fonte = "pluggy"` (lançamentos, saldos de conta e saldos de dívida) e a dívida do cartão criada pela sincronização se ficar sem saldo. Nada é apagado; é só um filtro na leitura.

### sincronizacoes.json → `execucoes[]`
`{em, ok, erro?, gravou, conexao: {status, execucao, atualizada_na_pluggy_em, proxima_atualizacao_automatica, consentimento_ate, erro}, contas: [{conta, conta_id, periodo, recebidas, ate_mes_coberto_por_documento, contagem: {novas, atualizadas, removidas, cobertas_por_documento, ignoradas}}]}`. Guarda as últimas 60.

### dividas.json → `dividas[]`
```
{id, credor, tipo: financiamento_imovel|financiamento_veiculo|emprestimo_pessoal|consignado|cartao|cheque_especial|outros,
 valor_contratado, data_contratacao, taxa_mensal, taxa_anual, cet_anual,
 sistema: price|sac|rotativo|desconhecido, parcelas_total, parcela_valor, dia_vencimento,
 saldos: [{data, saldo_devedor, origem, status}],
 pagamentos: [{data, valor, tipo: parcela|amortizacao_extra, juros, amortizacao, seguros_taxas, origem}],
 situacao: ativa|quitada}
```
Saldo devedor vem do credor (extrato do contrato). Quando calculado, `status: estimado`. Parcela paga não é igual a redução de saldo: só `amortizacao` reduz.

### emprestimos.json → `emprestimos[]`
Empréstimos entre pessoas, anotados na aba Pessoas. Campos: `id`, `pessoa`, `direcao` (`me_deve` ou `eu_devo`), `descricao`, `valor`, `data`, `vencimento`, `obs`, `pagamentos[]` (`id`, `data`, `valor`, `obs`), `situacao` (`aberto`/`quitado`, recalculada a cada mudança), `criado_em`, `atualizado_em`.
O que falta = `valor − soma dos pagamentos`; o back-end recusa pagamento maior que o que falta e valor menor que o já pago. **Não entram no patrimônio** nem nos cálculos do painel: aparecem à parte (aba Pessoas e modo simples).

### investimentos.json → `investimentos[]`
```
{id, instituicao, nome, tipo: cdb|lci|lca|tesouro_selic|tesouro_ipca|tesouro_pre|poupanca|fundo_di|acoes|outros,
 indexador: cdi|selic|ipca|pre|poupanca|nenhum, percentual_indexador, taxa_fixa_aa,
 data_inicio, vencimento, liquidez, tributacao: ir_regressivo|isento|come_cotas|outros,
 movimentos: [{data, tipo: aporte|resgate|ir|iof|taxa, valor, origem}],
 posicoes: [{data, saldo_bruto, saldo_liquido, origem, status}]}
```
Separação obrigatória: aportado (soma de aportes − resgates de principal), rendimento bruto (saldo bruto − aportado), impostos/taxas, rendimento líquido, patrimônio. Posições do extrato da corretora são `confirmado`; posições calculadas com CDI/Selic históricos são `estimado`.

### metas.json → `metas[]`
Criadas na aba Metas (`POST /api/metas`, `PUT|DELETE /api/metas/:id`, `POST /api/metas/:id/guardar {valor}` soma ou tira do guardado). Campo extra `usar_reserva`: o progresso acompanha o saldo das contas marcadas como reserva. A primeira meta entra no plano "Quando fico livre das dívidas" (aba Dívidas), depois das dívidas sem parcelas.

`{id, nome, valor_alvo, prazo (AAAA-MM), saldo_reservado, prioridade (1 = maior), aporte_mensal_planejado, investimento_vinculado_id, status}`

### indicadores.json
Séries do Banco Central (SGS): 432 Selic meta % a.a., 11 Selic diária, 12 CDI diário, 4389 CDI % a.a. Cada série guarda `registros [{data, valor}]`, a fonte e a data da consulta. Selic e CDI ficam separados. Não há atualização automática.

### documentos.json → `documentos[]`
`{id, nome_original, caminho, sha256, tipo: holerite|extrato|contrato|nota_corretagem|outros, instituicao, competencia, processado_em, registros_gerados: {holerites, movimentacoes, ...}}`

### avisos (arquivo `avisos`, fica só no servidor)
Avisos no celular (Web Push). Guarda a chave privada VAPID, por isso não sai em `/api/dados`, não aparece nas fontes e fica fora da exportação e da restauração da cópia de segurança. As chaves são geradas na primeira vez (`FINANCEIRO_VAPID_ASSUNTO` é opcional).

`{schema_version, chaves {publica, privada}, aparelhos [{id, endpoint, p256dh, auth, nome, criado_em, ultimo_envio, falhas}], tipos {fixa_vencendo, assinatura_nova, fatura, fechamento_mes: boolean}, enviados [{chave, em}], cartoes {id_do_cartao: {fechamento, vencimento, fechada {fechamento, vencimento}}}}`

`enviados` evita repetir um aviso (guarda cada chave por 120 dias). Aparelho some da lista quando a assinatura expira ou após 5 falhas seguidas. `cartoes` lembra o último ciclo visto de cada cartão; `fechada` é o último ciclo já fechado (datas de fechamento e vencimento), usado no aviso "fatura vence" e só muda quando o próximo ciclo fecha.

## Indicadores do painel (definições)

- **Salário líquido**: soma de `holerites.liquido` com competência no período.
- **Receitas (extrato)**: movimentações `receita` (inclui o salário creditado).
- **Despesas de consumo**: `despesa` (valor absoluto). Estornos abatem.
- **Pagamento de dívidas**: `pagamento_divida`.
- **Sobra mensal de caixa**: receitas − despesas de consumo − pagamentos de dívidas. Transferências internas e aportes/resgates não entram; aportes aparecem à parte como destino da sobra.
- **Investimentos**: última posição de cada aplicação até o fim do período.
- **Dívidas**: último saldo devedor de cada dívida ativa até o fim do período.
- **Patrimônio líquido**: saldo final das contas + investimentos − dívidas. Se faltar algum componente, o painel avisa em vez de tratar como zero.
