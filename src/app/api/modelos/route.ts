import { PROVEDORES, MODELOS_REGISTRO, disponibilidadeDoProvedor } from "@/lib/modelo/registro";
import { desempenhoPorOperacao } from "@/lib/modelo/uso";
import { verificarDisponibilidadeOllama } from "@/lib/modelo/ollama";

export const runtime = "nodejs";

/**
 * Observabilidade de Provedor + Modelo (Fase 8) — o que existe de verdade,
 * disponibilidade real (nunca hardcoded por nome de provedor), e o
 * desempenho histórico agregado (nunca um número inventado — vazio até que
 * chamadas reais aconteçam).
 *
 * Achado real (Fase 29): o gancho pra forçar checagem real do Ollama
 * (verificarDisponibilidadeOllama) existia desde a Fase 25 mas nunca
 * tinha sido chamado por NENHUMA rota — o comentário original já dizia
 * "/api/integracoes ou similar" mas isso nunca foi feito de verdade. Sem
 * isto, esta rota (a única que reporta status de provedor pro resto do
 * Jarvis) nunca carregava ollama.ts, e o serviço local ficava
 * "TEMPORARILY_UNAVAILABLE" pra sempre mesmo com o Ollama de pé e
 * respondendo de verdade.
 */
export async function GET() {
  await verificarDisponibilidadeOllama();

  const provedores = PROVEDORES.map((p) => ({
    id: p.id,
    nomeExibicao: p.nomeExibicao,
    status: disponibilidadeDoProvedor(p.id),
    modelos: MODELOS_REGISTRO.filter((m) => m.provedorId === p.id).map((m) => m.modeloId),
  }));

  const modelos = MODELOS_REGISTRO.map((m) => ({
    modeloId: m.modeloId,
    provedorId: m.provedorId,
    tier: m.tier,
    custoPor1M: m.custoPor1M,
    janelaContexto: m.janelaContexto,
    capacidades: m.capacidades,
  }));

  return Response.json({ provedores, modelos, desempenho: desempenhoPorOperacao() });
}
