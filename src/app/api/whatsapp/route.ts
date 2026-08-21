import { provedorWhatsapp, evolutionConfigurado } from "@/lib/whatsapp/adaptador";
import { numeroDonoAtual, definirNumeroDono, normalizarNumero } from "@/lib/whatsapp/seguranca";

export const runtime = "nodejs";

/** Status real — nunca CONECTADO sem o provedor confirmar. */
export async function GET() {
  if (!evolutionConfigurado()) {
    return Response.json({
      configurado: false,
      estado: "NAO_CONFIGURADO",
      numeroDono: numeroDonoAtual(),
    });
  }
  const status = await provedorWhatsapp.obterStatus();
  return Response.json({ configurado: true, numeroDono: numeroDonoAtual(), ...status });
}

/**
 * POST { acao: "qr" }          → pede QR novo ao provedor
 * POST { acao: "desconectar" } → logout da sessão
 * POST { acao: "definir_dono", numero } → define o único número autorizado
 */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!corpo?.acao) return Response.json({ erro: "acao_obrigatoria" }, { status: 400 });

  if (corpo.acao === "definir_dono") {
    if (!corpo.numero) return Response.json({ erro: "numero_obrigatorio" }, { status: 400 });
    definirNumeroDono(corpo.numero);
    return Response.json({ ok: true, numero: normalizarNumero(corpo.numero) });
  }

  if (!evolutionConfigurado()) {
    return Response.json({ erro: "nao_configurado", detalhe: "EVOLUTION_API_URL/EVOLUTION_API_KEY ausentes" }, { status: 503 });
  }

  if (corpo.acao === "qr") {
    const r = await provedorWhatsapp.obterQr();
    return Response.json(r);
  }

  if (corpo.acao === "desconectar") {
    const r = await provedorWhatsapp.desconectar();
    return Response.json(r);
  }

  return Response.json({ erro: "acao_desconhecida" }, { status: 400 });
}
