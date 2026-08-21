import { obterNivelAutonomia, definirNivelAutonomia, obterModoOrcamento, definirModoOrcamento } from "@/lib/autonomia";

export const runtime = "nodejs";

const DESCRICAO: Record<number, string> = {
  0: "Só sugere — plano fica pronto, nada executa sozinho.",
  1: "Executa tarefa só-leitura sozinho (padrão).",
  2: "Executa ação de baixo risco sozinho.",
  3: "Comunicação externa após aprovação.",
  4: "Autonomia ampla sob política explícita.",
};

const DESCRICAO_MODO: Record<string, string> = {
  ECONOMY: "Só modelo CHEAP, mesmo quando a tarefa pediria mais.",
  BALANCED: "Respeita o tier ideal calculado pela tarefa (padrão).",
  QUALITY: "Nunca desce abaixo de BALANCED, mesmo sob pressão de orçamento.",
  MAX_QUALITY: "Sempre tenta PREMIUM quando a capacidade existe.",
};

export async function GET() {
  const nivel = obterNivelAutonomia();
  const modoOrcamento = obterModoOrcamento();
  return Response.json({ nivel, descricao: DESCRICAO[nivel], modoOrcamento, descricaoModoOrcamento: DESCRICAO_MODO[modoOrcamento] });
}

export async function PATCH(req: Request) {
  const corpo = await req.json().catch(() => ({}));
  const resposta: Record<string, unknown> = {};

  if (corpo.nivel !== undefined) {
    if (typeof corpo.nivel !== "number") return Response.json({ erro: "nivel_invalido" }, { status: 400 });
    try {
      resposta.nivel = definirNivelAutonomia(corpo.nivel);
      resposta.descricao = DESCRICAO[resposta.nivel as number];
    } catch {
      return Response.json({ erro: "nivel_invalido" }, { status: 400 });
    }
  }

  if (corpo.modoOrcamento !== undefined) {
    if (typeof corpo.modoOrcamento !== "string") return Response.json({ erro: "modo_orcamento_invalido" }, { status: 400 });
    try {
      resposta.modoOrcamento = definirModoOrcamento(corpo.modoOrcamento);
      resposta.descricaoModoOrcamento = DESCRICAO_MODO[resposta.modoOrcamento as string];
    } catch {
      return Response.json({ erro: "modo_orcamento_invalido" }, { status: 400 });
    }
  }

  if (Object.keys(resposta).length === 0) return Response.json({ erro: "nada_para_atualizar" }, { status: 400 });
  return Response.json({ nivel: obterNivelAutonomia(), modoOrcamento: obterModoOrcamento(), ...resposta });
}
