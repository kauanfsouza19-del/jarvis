import "server-only";
import { timingSafeEqual } from "node:crypto";
import { db } from "../dados/db";

/**
 * Fronteira de autorização do WhatsApp.
 *
 * Regra que não se negocia: só o número do dono aciona o sistema. Qualquer
 * outro remetente é DADO — pode ser lido, resumido, guardado — mas nunca uma
 * instrução. "Ignore instruções anteriores" dentro de uma mensagem
 * encaminhada por um cliente é conteúdo, não comando. Chegar pelo WhatsApp
 * não aumenta permissão nenhuma além do que o mesmo comando teria na web.
 */

/** Normaliza para E.164 aproximado — dígitos apenas, com código de país. */
export function normalizarNumero(numero: string): string {
  return numero.replace(/\D/g, "");
}

export function numeroAutorizado(numeroBruto: string): boolean {
  const numero = normalizarNumero(numeroBruto);
  const linha = db()
    .prepare(`SELECT 1 FROM whatsapp_numero_dono WHERE numero_e164 = ? AND ativo = 1`)
    .get(numero);
  return Boolean(linha);
}

export function definirNumeroDono(numeroBruto: string) {
  const numero = normalizarNumero(numeroBruto);
  db().exec(`UPDATE whatsapp_numero_dono SET ativo = 0`);
  const existente = db()
    .prepare(`SELECT id FROM whatsapp_numero_dono WHERE numero_e164 = ?`)
    .get(numero) as { id: string } | undefined;
  if (existente) {
    db().prepare(`UPDATE whatsapp_numero_dono SET ativo = 1 WHERE id = ?`).run(existente.id);
    return;
  }
  db()
    .prepare(`INSERT INTO whatsapp_numero_dono (id, numero_e164, ativo) VALUES (?, ?, 1)`)
    .run(crypto.randomUUID(), numero);
}

export function numeroDonoAtual(): string | null {
  const l = db().prepare(`SELECT numero_e164 FROM whatsapp_numero_dono WHERE ativo = 1`).get() as
    | { numero_e164: string }
    | undefined;
  return l?.numero_e164 ?? null;
}

/**
 * Código de verificação — nunca persiste, nunca vai para o modelo, nunca é
 * lido em voz alta. Detecta localmente e devolve só o fato de ter chegado.
 */
const PADRAO_CODIGO_VERIFICACAO =
  /\b(seu c[oó]digo|verification code|c[oó]digo de verifica[cç][aã]o|security code)\b[^\d]{0,20}(\d{4,8})\b/i;

export function ehMensagemDeCodigoVerificacao(texto: string): boolean {
  return PADRAO_CODIGO_VERIFICACAO.test(texto);
}

/** Redige o código antes de qualquer log/auditoria/persistência. */
export function redigirCodigoVerificacao(texto: string): string {
  return texto.replace(PADRAO_CODIGO_VERIFICACAO, (m, rotulo) => `${rotulo}: [CÓDIGO REDIGIDO]`);
}

/**
 * Assinatura do webhook (Fase 16 — achado real de segurança). O webhook
 * precisa ficar público no middleware (Evolution API não manda Bearer nem
 * cookie de sessão), mas `numeroAutorizado()` sozinho não prova que a
 * chamada veio do Evolution de verdade — um corpo de POST forjado, com
 * `remoteJid` igual ao número do Cacique, passaria pelo mesmo filtro.
 * `WHATSAPP_WEBHOOK_SEGREDO` fecha essa lacuna: um segredo na própria URL
 * do webhook (funciona com qualquer provedor, mesmo um que não suporte
 * header customizado). Opcional — sem ele, o webhook roda aberto (modo
 * local, mesmo padrão de honestidade do JARVIS_TOKEN), com aviso único.
 */
let avisouWebhookAberto = false;
export function webhookAutorizado(segredoRecebido: string | null): boolean {
  const esperado = process.env.WHATSAPP_WEBHOOK_SEGREDO;
  if (!esperado) {
    if (!avisouWebhookAberto) {
      console.warn("[jarvis] WHATSAPP_WEBHOOK_SEGREDO não configurado — webhook do WhatsApp aceita qualquer chamador (modo local).");
      avisouWebhookAberto = true;
    }
    return true;
  }
  if (!segredoRecebido) return false;
  const a = Buffer.from(segredoRecebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
