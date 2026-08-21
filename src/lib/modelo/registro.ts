// Sem "server-only" de propósito — este arquivo é puro (só process.env,
// nenhuma API exclusiva de servidor Next), igual prospeccao/pontuacao.ts e
// prospeccao/marketing.ts: assim dá pra testar direto via
// testes/lib/resolver-ts.mjs (ver testes/modelo-roteador.mjs), incluindo
// forçar estado de provedor pra testar fallback de verdade sem precisar de
// uma segunda credencial real.

/**
 * Registro de Provedor + Modelo (Fase 8) — fonte única de configuração de
 * modelo, nunca mais espalhada. Antes desta fase, preço por 1M tokens
 * existia DUPLICADO em modelo/uso.ts e api/custo/route.ts (achado real
 * revisando o código) — os dois agora leem daqui.
 *
 * Mesmo espírito do registro de Tools (ferramentas/registro.ts): cada
 * provedor/modelo é um registro DECLARATIVO, nunca decisão espalhada pelo
 * código de quem chama. Adicionar um provedor novo é registrar aqui, nunca
 * reescrever o Router.
 */

export type StatusProvedor =
  | "AVAILABLE"
  | "REQUIRES_CREDENTIAL"
  | "DISABLED"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "TEMPORARILY_UNAVAILABLE"
  | "ERROR";

export type CapacidadeModelo = "reasoning" | "coding" | "vision" | "structured_output" | "tool_calling" | "research";
export type TierModelo = "CHEAP" | "BALANCED" | "PREMIUM";

export type ProvedorRegistro = {
  id: string;
  nomeExibicao: string;
  credencialEnv: string | null; // null = nunca precisa de credencial (não existe hoje, reservado)
  /** Estado forçado só para teste determinístico de fallback (ver seção "Verify fallback... locally controlled provider states" da Fase 8). Nunca lido fora de testes. */
  _estadoForcado?: StatusProvedor;
};

export type ClasseLatencia = "baixa" | "media" | "alta";

export type ModeloRegistro = {
  modeloId: string;
  provedorId: string;
  tier: TierModelo;
  custoPor1M: { entrada: number; saida: number };
  janelaContexto: number;
  capacidades: CapacidadeModelo[];
  /**
   * Classe de latência DECLARADA (Fase 9, seção 1) — expectativa conhecida
   * do modelo, nunca inventada; complementa (nunca substitui) a latência
   * EMPÍRICA medida de verdade em chamadas_modelo (ver modelo/uso.ts,
   * desempenhoPorOperacao) — o Router usa o dado empírico quando existe,
   * este campo é só o ponto de partida antes de haver histórico.
   */
  latenciaClasse: ClasseLatencia;
};

export const PROVEDORES: ProvedorRegistro[] = [
  { id: "anthropic", nomeExibicao: "Anthropic", credencialEnv: "ANTHROPIC_API_KEY" },
  { id: "openai", nomeExibicao: "OpenAI", credencialEnv: "OPENAI_API_KEY" },
];

export const MODELOS_REGISTRO: ModeloRegistro[] = [
  {
    modeloId: "claude-haiku-4-5",
    provedorId: "anthropic",
    tier: "CHEAP",
    custoPor1M: { entrada: 1, saida: 5 },
    janelaContexto: 200_000,
    capacidades: ["structured_output", "tool_calling"],
    latenciaClasse: "baixa",
  },
  {
    modeloId: "claude-sonnet-5",
    provedorId: "anthropic",
    tier: "BALANCED",
    custoPor1M: { entrada: 3, saida: 15 },
    janelaContexto: 1_000_000,
    capacidades: ["reasoning", "coding", "structured_output", "tool_calling", "research"],
    latenciaClasse: "media",
  },
  {
    modeloId: "claude-opus-5",
    provedorId: "anthropic",
    tier: "PREMIUM",
    custoPor1M: { entrada: 5, saida: 25 },
    janelaContexto: 1_000_000,
    capacidades: ["reasoning", "coding", "vision", "structured_output", "tool_calling", "research"],
    latenciaClasse: "alta",
  },
  // OpenAI — registrado de propósito mesmo sem OPENAI_API_KEY neste
  // ambiente: prova que a arquitetura é multi-provedor de verdade (ver
  // modelo/openai.ts), não só uma interface que só o Anthropic implementa.
  // Sem credencial, disponibilidadeDoProvedor() reporta REQUIRES_CREDENTIAL
  // honesto — nunca finge disponível.
  {
    modeloId: "gpt-4o-mini",
    provedorId: "openai",
    tier: "CHEAP",
    custoPor1M: { entrada: 0.15, saida: 0.6 },
    janelaContexto: 128_000,
    capacidades: ["structured_output", "tool_calling"],
    latenciaClasse: "baixa",
  },
  {
    modeloId: "gpt-4o",
    provedorId: "openai",
    tier: "BALANCED",
    custoPor1M: { entrada: 2.5, saida: 10 },
    janelaContexto: 128_000,
    capacidades: ["reasoning", "coding", "vision", "structured_output", "tool_calling"],
    latenciaClasse: "media",
  },
];

/**
 * Papel de Agente -> tier ideal (Fase 8, seção 10 — "Agent + Model
 * Selection"). Reflete os papéis já seedados em dados/db.ts (prospeccao,
 * pesquisa, pesquisa_instagram, abordagem) mais um padrão conservador pra
 * papel desconhecido. Não substitui a decisão do Router — é o SINAL que um
 * chamador que já sabe qual Agente foi selecionado (ver
 * agentes/repositorio.ts escolherAgentePorCapacidades) pode passar como
 * `qualidadeNecessaria` no pedido de roteamento.
 */
const TIER_POR_PAPEL: Record<string, TierModelo> = {
  abordagem: "BALANCED", // linguagem representando o Cacique — nem mecânico nem estratégico
  pesquisa: "CHEAP", // extração/classificação de sinal observado, determinístico na maior parte
  pesquisa_instagram: "CHEAP",
  prospeccao: "CHEAP",
};

export function tierParaPapel(papel: string): TierModelo {
  return TIER_POR_PAPEL[papel] ?? "BALANCED";
}

export function obterModelo(modeloId: string): ModeloRegistro | undefined {
  return MODELOS_REGISTRO.find((m) => m.modeloId === modeloId);
}

export function modelosDoProvedor(provedorId: string): ModeloRegistro[] {
  return MODELOS_REGISTRO.filter((m) => m.provedorId === provedorId);
}

export function modelosPorTier(tier: TierModelo): ModeloRegistro[] {
  return MODELOS_REGISTRO.filter((m) => m.tier === tier);
}

export function calcularCustoUsd(modeloId: string, tokensEntrada: number, tokensSaida: number): number {
  const m = obterModelo(modeloId);
  if (!m) return 0;
  return (tokensEntrada / 1_000_000) * m.custoPor1M.entrada + (tokensSaida / 1_000_000) * m.custoPor1M.saida;
}

/**
 * Estado transitório observado por provedor (RATE_LIMITED/QUOTA_EXCEEDED/
 * TEMPORARILY_UNAVAILABLE) — em memória de propósito: são sinais de sessão
 * (o provedor volta a ficar disponível sozinho depois de um tempo), nunca
 * configuração persistente. `registrarFalhaTransitoria` é chamado pelo
 * provedor real quando detecta o erro (ver modelo/anthropic.ts,
 * modelo/openai.ts); `_estadoForcado` no registro acima é só pra teste.
 */
const estadoTransitorio = new Map<string, { status: StatusProvedor; expiraEm: number }>();
const JANELA_ESTADO_TRANSITORIO_MS = 60_000;

export function registrarFalhaTransitoria(provedorId: string, status: "RATE_LIMITED" | "QUOTA_EXCEEDED" | "TEMPORARILY_UNAVAILABLE" | "ERROR"): void {
  estadoTransitorio.set(provedorId, { status, expiraEm: Date.now() + JANELA_ESTADO_TRANSITORIO_MS });
}

export function limparEstadoTransitorio(provedorId: string): void {
  estadoTransitorio.delete(provedorId);
}

export function disponibilidadeDoProvedor(provedorId: string): StatusProvedor {
  const provedor = PROVEDORES.find((p) => p.id === provedorId);
  if (!provedor) return "DISABLED";
  if (provedor._estadoForcado) return provedor._estadoForcado;

  const transitorio = estadoTransitorio.get(provedorId);
  if (transitorio) {
    if (transitorio.expiraEm > Date.now()) return transitorio.status;
    estadoTransitorio.delete(provedorId); // expirou — volta a checar credencial normalmente
  }

  if (provedor.credencialEnv && !process.env[provedor.credencialEnv]) return "REQUIRES_CREDENTIAL";
  return "AVAILABLE";
}
