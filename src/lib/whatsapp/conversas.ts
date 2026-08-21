import "server-only";
import { db } from "../dados/db";

/**
 * Centro de conversas do WhatsApp (Fase 11) — nunca uma engine de chat
 * separada: cada linha aqui é derivada de `whatsapp_mensagens`
 * (webhook/route.ts já grava tudo isso) agrupada por número remoto. Zero
 * tabela nova, zero lógica de mensagem duplicada — só uma VISÃO real sobre
 * o que já existe, pro Rule 8 (centro de comunicação profissional).
 */

export type ConversaWhatsapp = {
  numeroRemoto: string;
  conversaId: string | null;
  autorizado: boolean;
  totalMensagens: number;
  ultimaMensagem: string | null;
  ultimaDirecao: "entrada" | "saida" | null;
  ultimaEm: string;
  pendente: boolean; // última mensagem de entrada ainda não respondida (estado_processamento != 'respondida')
};

export function listarConversasWhatsapp(filtro: { busca?: string; soPendentes?: boolean } = {}): ConversaWhatsapp[] {
  const linhas = db()
    .prepare(
      `SELECT
         numero_remoto,
         MAX(conversa_id) AS conversa_id,
         MAX(autorizado) AS autorizado,
         COUNT(*) AS total,
         criado_em
       FROM whatsapp_mensagens
       GROUP BY numero_remoto`,
    )
    .all() as Array<{ numero_remoto: string; conversa_id: string | null; autorizado: number; total: number; criado_em: string }>;

  const resultado: ConversaWhatsapp[] = linhas.map((l) => {
    const ultima = db()
      .prepare(`SELECT conteudo_texto, direcao, criado_em, estado_processamento, direcao AS dir FROM whatsapp_mensagens WHERE numero_remoto = ? ORDER BY criado_em DESC LIMIT 1`)
      .get(l.numero_remoto) as { conteudo_texto: string | null; direcao: "entrada" | "saida"; criado_em: string; estado_processamento: string } | undefined;

    return {
      numeroRemoto: l.numero_remoto,
      conversaId: l.conversa_id,
      autorizado: l.autorizado === 1,
      totalMensagens: l.total,
      ultimaMensagem: ultima?.conteudo_texto ?? null,
      ultimaDirecao: ultima?.direcao ?? null,
      ultimaEm: ultima?.criado_em ?? l.criado_em,
      pendente: ultima?.direcao === "entrada" && ultima.estado_processamento !== "respondida" && ultima.estado_processamento !== "rejeitada",
    };
  });

  let filtrado = resultado.sort((a, b) => b.ultimaEm.localeCompare(a.ultimaEm));
  if (filtro.soPendentes) filtrado = filtrado.filter((c) => c.pendente);
  if (filtro.busca) {
    const alvo = filtro.busca.toLowerCase();
    filtrado = filtrado.filter((c) => c.numeroRemoto.includes(alvo) || c.ultimaMensagem?.toLowerCase().includes(alvo));
  }
  return filtrado;
}

export function mensagensDoNumero(numeroRemoto: string, limite = 100) {
  return db()
    .prepare(`SELECT * FROM whatsapp_mensagens WHERE numero_remoto = ? ORDER BY criado_em ASC LIMIT ?`)
    .all(numeroRemoto, limite);
}
