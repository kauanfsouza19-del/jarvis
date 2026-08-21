import { db } from "@/lib/dados/db";
import { calcularCustoUsd } from "@/lib/modelo/registro";
import { statusOrcamento } from "@/lib/modelo/orcamento";
import { obterModoOrcamento } from "@/lib/autonomia";

export const runtime = "nodejs";

/**
 * Custo real — agregado do que já foi gravado, nunca recalculado do zero.
 *
 * Fase 8: preço por 1M tokens agora vem do registro central
 * (modelo/registro.ts), e o total passou a somar as DUAS fontes reais de
 * custo — antes desta fase, só `mensagens` (resposta conversacional) era
 * contada; toda chamada de modelo feita por Tool/Orquestrador
 * (`chamadas_modelo`, existente desde a Fase 7) ficava de fora do total
 * reportado aqui (achado real revisando o código — o número mostrado nunca
 * bateu com o custo de verdade desde que o Router passou a existir).
 * Também expõe o status do orçamento global (tabela `orcamentos`, existia
 * desde antes mas nunca era comparada contra gasto nenhum).
 */
export async function GET() {
  const linhasMensagens = db()
    .prepare(
      `SELECT modelo, projeto_id, tokens_entrada, tokens_saida, cache_lido, criado_em
         FROM mensagens
        WHERE papel = 'assistant' AND modelo IS NOT NULL`,
    )
    .all() as Array<{
    modelo: string;
    projeto_id: string | null;
    tokens_entrada: number | null;
    tokens_saida: number | null;
    cache_lido: number | null;
    criado_em: string;
  }>;

  const linhasChamadas = db()
    .prepare(`SELECT provedor, modelo, operacao, tokens_entrada, tokens_saida, custo_usd, sucesso, modelo_original FROM chamadas_modelo`)
    .all() as Array<{
    provedor: string;
    modelo: string;
    operacao: string;
    tokens_entrada: number | null;
    tokens_saida: number | null;
    custo_usd: number;
    sucesso: number;
    modelo_original: string | null;
  }>;

  let custoTotalUsd = 0;
  let entradaTotal = 0;
  let saidaTotal = 0;
  let cacheLidoTotal = 0;
  const porModelo = new Map<string, { chamadas: number; custoUsd: number }>();
  const porProjeto = new Map<string, { chamadas: number; custoUsd: number }>();

  for (const l of linhasMensagens) {
    const entrada = l.tokens_entrada ?? 0;
    const saida = l.tokens_saida ?? 0;
    entradaTotal += entrada;
    saidaTotal += saida;
    cacheLidoTotal += l.cache_lido ?? 0;

    const custo = calcularCustoUsd(l.modelo, entrada, saida);
    custoTotalUsd += custo;

    const m = porModelo.get(l.modelo) ?? { chamadas: 0, custoUsd: 0 };
    m.chamadas++;
    m.custoUsd += custo;
    porModelo.set(l.modelo, m);

    const chave = l.projeto_id ?? "sem_projeto";
    const p = porProjeto.get(chave) ?? { chamadas: 0, custoUsd: 0 };
    p.chamadas++;
    p.custoUsd += custo;
    porProjeto.set(chave, p);
  }

  let chamadasFallback = 0;
  const porOperacao = new Map<string, { chamadas: number; custoUsd: number; falhas: number }>();
  for (const l of linhasChamadas) {
    custoTotalUsd += l.custo_usd;
    entradaTotal += l.tokens_entrada ?? 0;
    saidaTotal += l.tokens_saida ?? 0;
    if (l.modelo_original) chamadasFallback++;

    const m = porModelo.get(l.modelo) ?? { chamadas: 0, custoUsd: 0 };
    m.chamadas++;
    m.custoUsd += l.custo_usd;
    porModelo.set(l.modelo, m);

    const o = porOperacao.get(l.operacao) ?? { chamadas: 0, custoUsd: 0, falhas: 0 };
    o.chamadas++;
    o.custoUsd += l.custo_usd;
    if (!l.sucesso) o.falhas++;
    porOperacao.set(l.operacao, o);
  }

  // Fase 9 — observabilidade de roteamento (seção 19): últimas chamadas
  // reais com motivo de roteamento/escalonamento/fallback, nunca segredo
  // nem cadeia de pensamento — só metadado de execução já gravado.
  const chamadasRecentes = (
    db()
      .prepare(
        `SELECT provedor, modelo, operacao, sucesso, motivo_roteamento, motivo_fallback, modelo_original, nivel_escalonamento, criado_em
           FROM chamadas_modelo ORDER BY criado_em DESC LIMIT 20`,
      )
      .all() as Array<{
      provedor: string;
      modelo: string;
      operacao: string;
      sucesso: number;
      motivo_roteamento: string | null;
      motivo_fallback: string | null;
      modelo_original: string | null;
      nivel_escalonamento: number | null;
      criado_em: string;
    }>
  ).map((c) => ({
    provedor: c.provedor,
    modelo: c.modelo,
    operacao: c.operacao,
    sucesso: Boolean(c.sucesso),
    motivoRoteamento: c.motivo_roteamento,
    motivoFallback: c.motivo_fallback,
    modeloOriginal: c.modelo_original,
    nivelEscalonamento: c.nivel_escalonamento,
    criadoEm: c.criado_em,
  }));

  return Response.json({
    chamadasDeModeloTotal: linhasMensagens.length + linhasChamadas.length,
    chamadasFallback,
    tokensEntradaTotal: entradaTotal,
    tokensSaidaTotal: saidaTotal,
    tokensCacheLidoTotal: cacheLidoTotal,
    custoTotalUsd: Number(custoTotalUsd.toFixed(4)),
    porModelo: Object.fromEntries(porModelo),
    porProjeto: Object.fromEntries(porProjeto),
    porOperacao: Object.fromEntries(porOperacao),
    orcamentoGlobal: statusOrcamento("global"),
    modoOrcamento: obterModoOrcamento(),
    chamadasRecentes,
    observacao: linhasMensagens.length + linhasChamadas.length === 0 ? "Nenhuma chamada de modelo registrada ainda — custo real é R$0." : null,
  });
}
