# Plano · o que já existe e o que falta

Atualizado em 02/11/2026.

## Pronto

- [x] Publicação online: Dockerfile + `render.yaml` (Render grátis) com dados no Postgres do Neon ([PUBLICAR.md](PUBLICAR.md))
- [x] Login de um usuário (Argon2, cookie assinado, bloqueio após 5 erros, cabeçalho anti-CSRF)
- [x] Envio de documentos pela interface com prévia e conferência de totais antes de gravar: holerite (PDF), fatura Santander (PDF), extrato (OFX/CSV)
- [x] Classificação automática que aprende com as categorias que você escolhe
- [x] Abas Salários (descontos, uniforme) e Dívidas (parcelamentos, comprometimento das faturas, cadastro de dívidas como IPVA)
- [x] Histórico das últimas 30 versões de cada conjunto de dados e cópia de segurança (baixar/restaurar)
- [x] Layout para celular e atalho na tela de início (manifest)
- [x] PWA instalável: service worker só com a casca do app (dados nunca em cache), ícones maskable, botão Instalar, aviso sem internet
- [x] Página de diagnóstico no próprio link quando a configuração do Render está incompleta

- [x] Modelo de dados v1 (`docs/MODELO_DE_DADOS.md`) e modelos vazios em `dados-exemplo/`
- [x] Back-end Rust: leitura dos JSON, cálculos da Visão Geral, consulta ao BCB sob demanda, gravação atômica, testes de unidade
- [x] Front-end React: Visão Geral com 6 indicadores, 5 gráficos, metas, origem dos dados, filtro de mês/ano, tema claro e escuro, estados vazios
- [x] CI no GitHub Actions (testes do back, build do front)
- [x] Primeiro holerite importado (junho/2026), fora do repositório

## Etapa 1 · Base do sistema

- [x] Gravação pela interface com trava de escrita (importações, dívidas, categorias, backup)
- [ ] Validação de schema ao carregar (mensagens claras de campo inválido)
- [ ] Testes de integração da API (rotas com pasta temporária)
- [x] Abas no front (pelo endereço, `#salarios`, `#dividas`…)
- [x] Versão anterior guardada antes de cada gravação

## Etapa 2 · Salários

- [x] Aba Salários: composição dos descontos por mês, desconto de uniforme, tabela de holerites
- [ ] Separar proventos recorrentes e extraordinários (férias, 13º, PLR, horas extras)
- [ ] Conferência de INSS e IRRF pelas tabelas vigentes (tabelas versionadas por ano em JSON, com fonte)
- [x] Importador de holerite em PDF no back-end, com revisão antes de gravar

## Etapa 3 · Movimentações bancárias

- [x] Importadores: OFX, CSV e fatura Santander em PDF
- [ ] Extrato em PDF e Excel (preciso de um exemplo real de cada)
- [ ] Faturas de outros bancos
- [ ] Regras de classificação editáveis (descrição → natureza/categoria) e aprendizado com correções manuais
- [ ] Detecção de duplicatas pelo `hash` e de transferências entre contas próprias
- [ ] Conciliação: crédito do salário ↔ holerite, parcelas ↔ dívidas, aplicações ↔ investimentos
- [ ] Aba com tabela filtrável, fixas × variáveis × eventuais, saldo de caixa × resultado do mês

## Etapa 4 · Dívidas

- [x] Cadastro pela interface (dívidas informadas por você)
- [ ] Tabela de amortização Price e SAC, separando juros e amortização em cada parcela
- [ ] Previsão de quitação e custo total; simulação de amortização extra (reduzir prazo × reduzir parcela)
- [ ] Comparação avalanche (maior juro primeiro) × bola de neve (menor saldo primeiro)
- [ ] Marcar como estimativa tudo que não vier do contrato ou do extrato do credor

## Etapa 5 · Investimentos

- [ ] Cadastro de aplicações, aportes e resgates pela interface
- [ ] Rendimento diário por CDI/Selic históricos (séries 11 e 12) × percentual contratado; IPCA e prefixados depois
- [ ] IR regressivo (22,5% a 15%), IOF nos primeiros 30 dias, isenção de LCI/LCA; come-cotas para fundos
- [ ] Histórico completo das séries do BCB por intervalo de datas (a rota atual busca só os 20 últimos registros)
- [ ] Gráfico aportado × rendimento bruto × impostos × líquido; confirmado (extrato) × calculado

## Etapa 6 · Metas

- [ ] Cadastro com valor-alvo, prazo, reservado, prioridade e investimento vinculado
- [ ] Aporte mensal necessário e data prevista em cenários conservador, intermediário e otimista

## Etapa 7 · Simulador

- [ ] Projeção em 6 meses, 1, 3 e 5 anos: renda, despesas, dívidas, aportes e rendimentos
- [ ] Premissas editáveis (reajuste salarial, inflação, taxa de juros, estratégia de quitação), sempre exibidas junto ao resultado
- [ ] Comparar cenários com e sem aportes adicionais

## Depois

- [ ] Empacotar como executável único (front embutido no binário) ou contêiner Docker
- [x] Autenticação

## V2

- [x] Login com Google (OAuth com PKCE, só o e-mail cadastrado), senha como acesso de emergência
- [x] Script de teste da Pluggy (`scripts/pluggy_teste.py`): contas e transações reais
- [x] Sincronização com a Pluggy (`POST /api/sincronizar`), sem duplicar com faturas já importadas
- [x] Botão "Sincronizar agora", indicador da última sincronização e aviso de autorização vencendo
- [x] Agendamento diário pelo GitHub Actions (`.github/workflows/sincronizar.yml`)
- [x] Aviso ao enviar fatura/extrato de um mês que já veio pelo banco
- [x] Saldo do cartão (limite usado) vindo do banco em Dívidas e no patrimônio
- [x] Saldo da conta no fim de cada mês reconstruído a partir do banco
- [x] Visão geral redesenhada: agora (saldo, fatura, patrimônio), o mês em uma frase, categorias com comparação justa, lista de lançamentos com busca, filtros e categoria editável, 12 meses
- [x] Botão para esconder os valores (vale para todas as abas e gráficos)
- [ ] Previsão de fim do desconto de uniforme editável pela interface
- [ ] Criptografia da pasta de dados em repouso
