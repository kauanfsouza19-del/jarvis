import { db } from "@/lib/dados/db";

export const runtime = "nodejs";

/** Estado real do sistema. Nada aqui é estimado. */
export async function GET() {
  try {
    const n = (sql: string) => (db().prepare(sql).get() as { n: number }).n;

    return Response.json({
      banco: true,
      memorias: n("SELECT COUNT(*) n FROM memorias WHERE estado='ATIVA'"),
      conhecimentoProjeto: n("SELECT COUNT(*) n FROM projeto_conhecimento WHERE obsoleto=0"),
      fontes: n("SELECT COUNT(*) n FROM fontes_conhecimento"),
      trechos: n("SELECT COUNT(*) n FROM trechos_conhecimento"),
      conversas: n("SELECT COUNT(*) n FROM conversas WHERE estado='ativa'"),
      tarefasAbertas: n("SELECT COUNT(*) n FROM tarefas WHERE estado IN ('aberta','fazendo')"),
      auditoria: n("SELECT COUNT(*) n FROM auditoria"),
      // Presença da chave, nunca o valor.
      modelo: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  } catch (e) {
    return Response.json(
      { banco: false, erro: e instanceof Error ? e.message : "erro" },
      { status: 503 },
    );
  }
}
