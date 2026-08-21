import { REGISTRO_FERRAMENTAS } from "@/lib/ferramentas/registro";
import { disponibilidadeDe, custoDe } from "@/lib/ferramentas/tipos";

export const runtime = "nodejs";

/**
 * O que existe de verdade e o que é fronteira definida pra depois — nunca
 * junto sem essa distinção. `capacidade` e `disponibilidade` (um dos cinco
 * estados reais) são o que permite responder com honestidade "consigo fazer
 * isso" vs. "isso ainda depende de X" sem hardcode — é a mesma leitura que
 * o Planejador faz internamente, só que exposta pra fora.
 */
export async function GET() {
  return Response.json({
    ferramentas: REGISTRO_FERRAMENTAS.map((f) => ({
      nome: f.nome,
      descricao: f.descricao,
      capacidade: f.capacidade,
      nivelPermissao: f.nivelPermissao,
      exigeAprovacaoExplicita: f.exigeAprovacaoExplicita,
      implementado: f.implementado,
      disponibilidade: disponibilidadeDe(f),
      custo: custoDe(f),
    })),
  });
}
