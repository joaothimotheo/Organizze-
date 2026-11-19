# "Vou receber um dinheiro": onde é melhor usar

## Para que serve
Quando entra um dinheiro fora do comum (13º, férias, restituição), você quer decidir antes para onde ele vai: separar o que já tem destino (IPVA do ano que vem, uma compra pessoal) e saber qual conta vale mais a pena adiantar com o resto, e quanto isso economiza.

## Abordagens consideradas
1. **Calculadora com regras (escolhida).** Conta fixa e previsível, grátis, na hora, dados não saem do servidor.
2. IA (Claude) conversando: flexível, mas envia os dados financeiros para fora, tem custo por uso e respostas variáveis.
3. Regras + IA explicando por cima: dá para somar depois, se fizer falta.

## Como funciona
Um quadro novo na aba **Objetivos**, entre a reserva e o simulador: **"Vou receber um dinheiro"**.

1. Você informa **quanto** e **em que mês** vai entrar.
2. Lista **"Já tem destino"**: você adiciona linhas com nome e valor (ex.: IPVA 2027 R$ 1.900; Compra pessoal R$ 800). Elas saem primeiro, na ordem que você colocou.
3. O que sobra, o sistema sugere nesta ordem, explicando cada passo:
   1. **Dívidas atrasadas** (sem parcelas e com vencimento já passado, como o IPVA 2025): quitar, porque crescem com multa e juros e travam o licenciamento.
   2. **Dívidas com juros de 1% ao mês ou mais**, da mais cara para a mais barata: adiantar parcelas **do fim para o começo** (as últimas são as que têm mais desconto). Mostra quantas parcelas dá para adiantar, quanto pagaria, quanto economiza em juros e em que mês fica livre dela em vez de quando ficaria.
   3. **Reserva de emergência**: completar até a meta (se houver meta que acompanha a reserva).
   4. **Dívidas sem juros** (como o Parcelamento Nubank e as compras parceladas do cartão): adiantar não economiza, só libera o mês. Aparece como opção, com esse aviso.
   5. **Sobra**: guardar na reserva.
4. Embaixo, o resumo: total separado, total sugerido, economia de juros somada e o novo mês em que você fica livre de todas as dívidas.

## Juros de cada dívida
- Usa a taxa cadastrada, se houver.
- Senão, **calcula** a partir do valor original, número total de parcelas e valor da parcela (sistema de parcelas fixas). Ex.: Empréstimo Santander, R$ 3.994,55 em 18 × R$ 376,65 → cerca de 6% ao mês. Parcelamento Nubank, R$ 3.876 em 19 × R$ 204 → 0%.
- Sem dados para calcular: a dívida entra como "juros desconhecidos", depois da reserva, com um aviso para cadastrar a taxa ou o valor original.
- A fatura do cartão (limite usado) não entra: ela já é paga todo mês.

## Desconto ao adiantar
Estimativa pelo valor presente de cada parcela na taxa da dívida: parcela ÷ (1 + taxa)^meses até o vencimento dela. É o desconto que a lei garante na antecipação (CDC art. 52); o valor exato quem informa é o banco, e o quadro diz isso.

## Decisões minhas (pode mudar)
- O que você digita (valor, mês e separações) fica guardado **no aparelho**, não no servidor. Se preferir que apareça igual no celular e no computador, guardo no servidor.
- A linha de corte entre "dívida cara" e "reserva primeiro" é **1% ao mês**.
- Não grava nada sozinho: é só sugestão. Adiantar de verdade continua sendo no app do banco.

## Fora do escopo
- Investimentos (onde aplicar o que sobrar).
- Integração com o banco para adiantar parcelas.
