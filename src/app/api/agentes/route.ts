import { listarAgentes, criarAgente } from "@/lib/agentes/repositorio";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ agentes: listarAgentes(false) });
}

/**
 * Criação de agente é configuração, nunca geração de código. O corpo vira
 * uma linha na tabela `agentes` — nada aqui executa nada.
 */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!corpo?.nome || !corpo?.papel || !corpo?.objetivo || !Array.isArray(corpo?.capacidades)) {
    return Response.json({ erro: "nome_papel_objetivo_capacidades_obrigatorios" }, { status: 400 });
  }
  const agente = criarAgente({
    nome: corpo.nome,
    papel: corpo.papel,
    objetivo: corpo.objetivo,
    capacidades: corpo.capacidades,
    instrucoes: corpo.instrucoes ?? null,
    nivelAutonomiaPadrao: corpo.nivelAutonomiaPadrao ?? 1,
  });
  return Response.json({ agente }, { status: 201 });
}
