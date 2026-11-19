import type { VisaoGeral as Visao } from "../api";
import { GraficoCategorias, GraficoDividas, GraficoFluxo, GraficoInvestimentos, GraficoPatrimonio } from "../componentes/Graficos";
import { Indicador, Painel, Vazio } from "../componentes/Indicador";
import { data, numero, reais } from "../formato";

/** Visão geral do modelo antigo (só documentos): indicadores do mês ou do ano e gráficos por mês. */
export default function VisaoGeralAntiga({ visao }: { visao: Visao }) {
  const k = visao.indicadores;
  return (
    <>
    <section className="kpis" aria-label="Indicadores do período">
      <Indicador
        rotulo="Salário líquido"
        valor={k.salario?.liquido ?? null}
        estimado={k.salario?.tem_estimativa}
        detalhe={k.salario ? `${k.salario.holerites} holerite${k.salario.holerites > 1 ? "s" : ""} · bruto ${reais(k.salario.bruto)}` : "Envie seus holerites na aba Enviar"}
      />
      <Indicador
        rotulo="Despesas de consumo"
        valor={k.fluxo?.despesas_consumo ?? null}
        estimado={k.fluxo?.tem_estimativa}
        detalhe={
          k.fluxo
            ? k.fluxo.tem_extrato_receita
              ? `+ ${reais(k.fluxo.pagamento_dividas)} em pagamento de dívidas`
              : "Só cartão de crédito · falta o extrato da conta"
            : "Envie a fatura ou o extrato na aba Enviar"
        }
      />
      <Indicador
        rotulo="Sobra mensal de caixa"
        comSinal
        valor={k.fluxo?.sobra ?? null}
        estimado={k.fluxo?.receita_estimada_pelo_holerite}
        detalhe={
          k.fluxo
            ? k.fluxo.receita_estimada_pelo_holerite
              ? `Salário ${reais(k.fluxo.receitas)} − cartão. Contas pagas fora do cartão ainda não entram`
              : `Receitas ${reais(k.fluxo.receitas)} · aportes ${reais(k.fluxo.aportes)}`
            : "Calculada a partir do extrato"
        }
      />
      <Indicador
        rotulo="Investimentos"
        valor={k.investimentos && k.investimentos.aplicacoes > 0 ? k.investimentos.saldo : null}
        estimado={k.investimentos?.tem_estimativa}
        detalhe={
          k.investimentos && k.investimentos.aplicacoes > 0
            ? `Aportado ${reais(k.investimentos.aportado)} · rendimento ${reais(k.investimentos.rendimento)}`
            : k.investimentos?.sem_posicao
              ? "Há aportes sem posição informada"
              : "Cadastre aplicações e aportes"
        }
      />
      <Indicador
        rotulo="Dívidas"
        valor={k.dividas_total}
        estimado={k.dividas_estimado}
        detalhe={k.dividas_qtd ? `${k.dividas_qtd} dívida${k.dividas_qtd > 1 ? "s ativas" : " ativa"}` : "Cadastre na aba Dívidas"}
      />
      <Indicador
        rotulo="Patrimônio líquido"
        comSinal
        valor={k.patrimonio?.valor ?? null}
        estimado={k.patrimonio?.tem_estimativa}
        detalhe={
          k.patrimonio
            ? k.patrimonio.falta.length
              ? `Falta: ${k.patrimonio.falta.join(", ")}`
              : "Contas + investimentos − dívidas"
            : "Precisa de saldos, investimentos ou dívidas"
        }
      />
    </section>

    <section className="grid">
      <Painel titulo="Receitas × despesas" descricao="Por mês do ano selecionado. Sem extrato da conta, a receita é o líquido do holerite.">
        <GraficoFluxo v={visao} />
      </Painel>
      <Painel titulo="Evolução do patrimônio líquido" descricao="Contas + investimentos − dívidas, no fim de cada mês.">
        <GraficoPatrimonio v={visao} />
      </Painel>
      <Painel titulo="Composição das despesas" descricao="Despesas de consumo por categoria no período.">
        <GraficoCategorias v={visao} />
      </Painel>
      <Painel titulo="Investimentos: aportado × rendimento" descricao="Dinheiro que você colocou separado do que o investimento rendeu.">
        <GraficoInvestimentos v={visao} />
      </Painel>
      <Painel titulo="Saldo devedor por dívida" descricao="Último saldo informado até o fim do período.">
        <GraficoDividas v={visao} />
      </Painel>
      <Painel titulo="Metas" descricao="Progresso em relação ao valor-alvo.">
        {visao.metas.length ? (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Meta</th>
                  <th style={{ textAlign: "right" }}>Reservado</th>
                  <th style={{ textAlign: "right" }}>Alvo</th>
                  <th style={{ textAlign: "right" }}>%</th>
                  <th>Prazo</th>
                </tr>
              </thead>
              <tbody>
                {visao.metas.map((m) => (
                  <tr key={m.id || m.nome}>
                    <td>{m.nome}</td>
                    <td className="n">{reais(m.saldo_reservado)}</td>
                    <td className="n">{reais(m.valor_alvo)}</td>
                    <td className="n">{numero(m.percentual)}%</td>
                    <td>{data(m.prazo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Vazio titulo="Nenhuma meta cadastrada">Informe o objetivo, o valor-alvo, o prazo e quanto já tem guardado.</Vazio>
        )}
      </Painel>
    </section>
    </>
  );
}
