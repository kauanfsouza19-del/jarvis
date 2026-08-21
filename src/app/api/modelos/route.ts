import { PROVEDORES, MODELOS_REGISTRO, disponibilidadeDoProvedor } from "@/lib/modelo/registro";
import { desempenhoPorOperacao } from "@/lib/modelo/uso";

export const runtime = "nodejs";

/**
 * Observabilidade de Provedor + Modelo (Fase 8) — o que existe de verdade,
 * disponibilidade real (nunca hardcoded por nome de provedor), e o
 * desempenho histórico agregado (nunca um número inventado — vazio até que
 * chamadas reais aconteçam).
 */
export async function GET() {
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
