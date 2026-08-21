import { listarProspects, criarOuAtualizarProspect, salvarDiagnostico, obterProspect } from "@/lib/prospeccao/repositorio";
import { diagnosticarSite } from "@/lib/pesquisa/navegador";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  return Response.json({
    prospects: listarProspects({
      vertical: url.searchParams.get("vertical") ?? undefined,
      cidade: url.searchParams.get("cidade") ?? undefined,
      estado: url.searchParams.get("estado") ?? undefined,
    }),
  });
}

/**
 * Duas ações, mesma rota:
 * - { acao: "criar", ... }        → registra um prospect (manual ou de fonte externa já resolvida)
 * - { acao: "diagnosticar", id }  → roda o Playwright real sobre o site do prospect e grava score
 *
 * Descoberta automática por vertical/cidade (Google Places) fica de fora
 * até GOOGLE_PLACES_API_KEY existir — ver /api/integracoes.
 */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!corpo?.acao) return Response.json({ erro: "acao_obrigatoria" }, { status: 400 });

  if (corpo.acao === "criar") {
    if (!corpo.negocio || !corpo.vertical) {
      return Response.json({ erro: "negocio_e_vertical_obrigatorios" }, { status: 400 });
    }
    const { prospect, novo } = criarOuAtualizarProspect({
      negocio: corpo.negocio,
      vertical: corpo.vertical,
      cidade: corpo.cidade ?? null,
      placeId: corpo.placeId ?? null,
      website: corpo.website ?? null,
      telefonePublico: corpo.telefonePublico ?? null,
      whatsappPublico: corpo.whatsappPublico ?? null,
      emailPublico: corpo.emailPublico ?? null,
      instagram: corpo.instagram ?? null,
      facebook: corpo.facebook ?? null,
      cnpj: corpo.cnpj ?? null,
      fonte: corpo.fonte ?? "manual",
      notas: corpo.notas ?? null,
    });
    return Response.json({ prospect, novo }, { status: novo ? 201 : 200 });
  }

  if (corpo.acao === "diagnosticar") {
    if (!corpo.id) return Response.json({ erro: "id_obrigatorio" }, { status: 400 });
    const p = obterProspect(corpo.id);
    if (!p) return Response.json({ erro: "prospect_nao_encontrado" }, { status: 404 });
    if (!p.website) return Response.json({ erro: "prospect_sem_website" }, { status: 400 });

    const sinais = await diagnosticarSite(p.website);
    const resultado = salvarDiagnostico(corpo.id, sinais);
    return Response.json({ sinais, resultado, prospect: obterProspect(corpo.id) });
  }

  return Response.json({ erro: "acao_desconhecida" }, { status: 400 });
}
