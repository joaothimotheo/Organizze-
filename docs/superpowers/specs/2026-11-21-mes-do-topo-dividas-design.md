# Mês do topo em Dívidas e Contas fixas — design curto

Data: 21/11/2026 · Branch: `v4` · Status: aguardando aprovação

## Por quê
O usuário troca o mês na barra de cima e quer que as telas acompanhem — principalmente **Dívidas**, para ter a **visão do futuro**: como vai estar num mês à frente (quanto ainda deve, o que cai naquele mês, o que já terá quitado).

Hoje seguem o mês: Início, Movimentos, Análises, Categorias, Salários. Ignoram (mostram sempre hoje): Dívidas, Contas fixas, Objetivos, Pessoas.

## Objetivos
1. **Dívidas** num mês **futuro** mostra a projeção daquele mês (esboço abaixo).
2. **Contas fixas** segue o mês: passado = pagas/faltaram; futuro = o que vai ser cobrado.
3. Mês atual: as duas telas como hoje.

## Fora do escopo / anti-objetivos
- Dívidas num mês passado não vira histórico: continua mostrando hoje, com o aviso "Para ver o futuro, escolha um mês à frente" (o histórico de pagamentos já existe dentro de cada dívida).
- Objetivos e Pessoas continuam mostrando hoje.
- Projeção nunca pode parecer dado real: sempre com a faixa "Projeção: supõe parcelas pagas em dia".
- Não muda nada no servidor nem nos dados gravados.

## Abordagem
Só uma faz sentido: **cálculo no front**, em função pura nova em `frontend/src/dividas.ts`, reaproveitando `juntarDividas(b, hoje)` (que já tem parcela, restantes, taxa, `quitarHoje`, `fim`) e a mesma conta de juros do simulador `simularAdiantar`. Calcular no servidor duplicaria toda a lógica de dívidas, que hoje só existe no front.

## Design (decisões do usuário e minhas)
- `App.tsx` passa `ano`/`mes` (os do topo) para `Dividas` e `Fixas`. "Ano inteiro" (`mes` nulo): Dívidas usa dezembro daquele ano se for futuro; Contas fixas usa o mês atual. *(minha)*
- **Projeção de uma dívida até o fim do mês M** *(minha, a partir do que o usuário aprovou)*: número de parcelas que vencem de hoje até M = `k`; com parcela, saldo = parcela × parcelas que ainda faltam depois de M (nominal, com ou sem taxa; é a mesma base do "Você deve" e do valor de cada dívida na tela de hoje, não o valor presente do `quitarHoje`); `k ≥ restantes` → quitada (mostra o mês da última parcela). Parcela de M = a parcela se vencer em M. Parcelas do cartão: as que a Pluggy já mostra a vencer, por fatura (competência). Dívida sem parcela (ex.: pessoas): valor de hoje, "sem data".
- **Topo da tela no mês futuro:** "Você ainda vai dever R$ X (hoje: R$ Y)", "Parcelas de <mês> R$ Z · N% do salário" (mesmo `salarioMedio`), "Quitadas até lá: …".
- **Lista:** Dívida · Saldo em <mês> · Parcela de <mês> · Faltam (parcelas depois de M ou "sem data"); quitadas até lá saem da lista e vão para a linha "Quitadas até lá".
- Botões de cadastrar/editar/pagar e as sugestões de pagamento ficam escondidos no modo projeção (só leitura). *(minha)*
- **Contas fixas:** usa o mês escolhido em `situacao`/`resumo` (já recebem `mes`). Futuro: todas "a vencer", com total do mês; passado: "paga"/"atrasada" daquele mês. Sugestões de novas fixas e cadastro continuam olhando hoje.

Esboço (março/2027):
```
Projeção: supõe parcelas pagas em dia.
Você ainda vai dever  R$ 8.420,00   (hoje: R$ 14.300,00)
Parcelas de março     R$ 1.150,00 · 24% do salário
Quitadas até lá: Parcelamento Nubank (fev/2027), IPVA

Dívida               Saldo em março   Parcela de março   Faltam
Empréstimo Santander  R$ 5.900,00      R$ 412,80          6
Cartão (parcelas)     R$ 1.320,00      R$ 540,00          3
Pessoa: João          R$ 1.200,00      —                  sem data
```

## Fica com o construtor
Nomes, componentes, estilos (reaproveitar os da tela); testes da função de projeção (dívida com juros, sem juros, quitada antes do mês, cartão por fatura, sem data, mês = atual).

## Adendo (21/11/2026): quadros da tela de hoje também na projeção
Pedido do usuário: na projeção aparecem também (1) os quadros por tipo, (2) "Parcelas já comprometidas" e (3) "Quando fico livre das dívidas", calculados a partir do mês escolhido.

- **Quadros por tipo:** os mesmos blocos de hoje (Cartão, Empréstimos, Pessoas… com o total de cada tipo), com as dívidas da projeção (sem as quitadas até lá). Cada dívida vira uma versão projetada: parcelas pagas = pagas de hoje + parcelas até o mês; faltam = as de depois; barra de progresso por essas contagens; "Próxima" = a primeira parcela do mês escolhido em diante; valor = saldo projetado (nominal). Linhas só de leitura: sem editar, excluir, ligar pagamento nem sugestões. *(minha)*
- **Parcelas já comprometidas:** o mesmo gráfico, só com as faturas do mês escolhido em diante.
- **Quando fico livre:** o mesmo quadro, começando no mês escolhido, com as parcelas do mês em diante. Dívidas sem parcelas (tributos, pessoas) e a meta entram com o valor de hoje (a projeção não supõe pagamento delas). O valor "quanto consegue separar por mês" continua o mesmo campo de hoje. *(minha)*
- Continua só leitura e com a faixa "Projeção: supõe parcelas pagas em dia."
