/**
 * Taxonomia de falha de chamada de modelo (Fase 10, Rule 4) — função pura,
 * sem I/O, sem "server-only": categoriza um erro real numa das causas
 * distintas que o Router precisa diferenciar pra decidir o que fazer a
 * seguir. Nunca decide "tentar de novo cegamente" — cada categoria aponta
 * pra UMA estratégia, e estratégia de retry tem teto explícito (nunca
 * indefinido).
 */

export type CategoriaFalha =
  | "CREDENCIAL_AUSENTE"
  | "RATE_LIMIT"
  | "COTA_ESGOTADA"
  | "REDE_TRANSITORIA"
  | "TIMEOUT"
  | "PROVEDOR_INDISPONIVEL"
  | "MODELO_INDISPONIVEL"
  | "RESPOSTA_INVALIDA"
  | "ORCAMENTO_EXCEDIDO"
  | "REJEICAO_SEGURANCA"
  | "FALHA_PERMANENTE";

export type EstrategiaFallback =
  | "RETENTAR_MESMO_PROVEDOR" // erro claramente transitório, só faz sentido tentar de novo até o teto
  | "TROCAR_PROVEDOR" // provedor/modelo específico com problema, próximo da cadeia pode não ter
  | "REBAIXAR_QUALIDADE" // orçamento — desce de tier, nunca troca de provedor pra contornar limite
  | "USAR_DETERMINISTICO" // nenhum modelo resolve isto de verdade (ex: credencial ausente em toda a cadeia)
  | "FALHAR_HONESTO"; // rejeição de segurança, resposta inválida repetida — nunca insistir escondendo o motivo

/** Teto de retry NO MESMO provedor — nunca indefinido, nunca mais que isto mesmo se o chamador esquecer de checar. */
export const MAX_RETENTATIVAS_MESMO_PROVEDOR = 1;

const PADROES_REDE = /ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|fetch failed|network|socket/i;
const PADROES_TIMEOUT = /timeout|timed out|AbortError/i;
const PADROES_CREDENCIAL = /API_KEY|não configurada|not configured|unauthorized|invalid api key|authentication/i;
const PADROES_SEGURANCA = /content policy|safety|moderation|blocked by/i;
const PADROES_MODELO_INDISPONIVEL = /model.*not found|modelo.*não encontrado|does not exist|decommissioned/i;

/**
 * `mensagem` é o texto de erro (já truncado por quem chama, como o resto do
 * código já faz); `statusHttp` vem de provedores que expõem status real
 * (Anthropic SDK, fetch cru da OpenAI) — nunca inventado quando ausente.
 */
export function classificarFalha(mensagem: string, statusHttp?: number, origemValidacao?: boolean): CategoriaFalha {
  // Validação (schema/semântica) sempre chega aqui com origemValidacao=true
  // — nunca confundida com erro de transporte, mesmo que a mensagem também
  // contenha palavras como "inválid[oa]".
  if (origemValidacao) return "RESPOSTA_INVALIDA";

  if (statusHttp === 401 || statusHttp === 403 || PADROES_CREDENCIAL.test(mensagem)) return "CREDENCIAL_AUSENTE";
  if (statusHttp === 429) {
    return /quota|credit|balance|insufficient/i.test(mensagem) ? "COTA_ESGOTADA" : "RATE_LIMIT";
  }
  if (statusHttp === 404 || PADROES_MODELO_INDISPONIVEL.test(mensagem)) return "MODELO_INDISPONIVEL";
  if (PADROES_SEGURANCA.test(mensagem)) return "REJEICAO_SEGURANCA";
  if (PADROES_TIMEOUT.test(mensagem)) return "TIMEOUT";
  if (PADROES_REDE.test(mensagem)) return "REDE_TRANSITORIA";
  if (statusHttp && statusHttp >= 500) return "PROVEDOR_INDISPONIVEL";
  if (statusHttp && statusHttp >= 400) return "FALHA_PERMANENTE";
  return "FALHA_PERMANENTE"; // sem sinal nenhum — nunca assume transitório sem evidência
}

/**
 * `tentativasNoMesmoProvedor` é quantas vezes ESTE provedor já foi tentado
 * nesta cadeia (0 na primeira falha) — controla o teto de retry.
 */
export function estrategiaParaFalha(categoria: CategoriaFalha, tentativasNoMesmoProvedor: number): EstrategiaFallback {
  if (categoria === "ORCAMENTO_EXCEDIDO") return "REBAIXAR_QUALIDADE";
  if (categoria === "REJEICAO_SEGURANCA" || categoria === "RESPOSTA_INVALIDA") return "FALHAR_HONESTO";
  if (categoria === "CREDENCIAL_AUSENTE") return "USAR_DETERMINISTICO";
  if ((categoria === "REDE_TRANSITORIA" || categoria === "TIMEOUT") && tentativasNoMesmoProvedor < MAX_RETENTATIVAS_MESMO_PROVEDOR) {
    return "RETENTAR_MESMO_PROVEDOR";
  }
  // RATE_LIMIT/COTA_ESGOTADA/PROVEDOR_INDISPONIVEL/MODELO_INDISPONIVEL/
  // FALHA_PERMANENTE, ou rede/timeout que já esgotou o teto de retry —
  // sempre troca de provedor, nunca insiste no mesmo.
  return "TROCAR_PROVEDOR";
}
