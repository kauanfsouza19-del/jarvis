import "server-only";
import { obterAccessTokenValido } from "./oauth";

/**
 * Gmail API real (v1, REST direto — sem SDK) — substitui o stub
 * `gmail.buscar`/`gmail.ler` da Fase 8. Só leitura (escopo gmail.readonly),
 * nunca envia nada — não existe endpoint de envio aqui de propósito, o
 * mesmo motivo do stub original nunca ter previsto `gmail.enviar`.
 */

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export type EmailResumo = { id: string; assunto: string; remetente: string; data: string; trecho: string };
export type EmailCompleto = EmailResumo & { corpo: string };

function cabecalho(headers: Array<{ name: string; value: string }> | undefined, nome: string): string {
  return headers?.find((h) => h.name.toLowerCase() === nome.toLowerCase())?.value ?? "";
}

/** Decodifica base64url (Gmail usa esse formato, não base64 padrão). */
function decodificarBase64Url(dado: string): string {
  const normalizado = dado.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(normalizado, "base64").toString("utf8");
  } catch {
    return "";
  }
}

type ParteGmail = { mimeType?: string; body?: { data?: string }; parts?: ParteGmail[] };

/** Procura texto plano primeiro; cai pra HTML (com as tags removidas) só se não achar. */
function extrairCorpo(payload: ParteGmail | undefined): string {
  if (!payload) return "";
  const achar = (parte: ParteGmail, tipo: string): string | null => {
    if (parte.mimeType === tipo && parte.body?.data) return decodificarBase64Url(parte.body.data);
    for (const filha of parte.parts ?? []) {
      const achado = achar(filha, tipo);
      if (achado) return achado;
    }
    return null;
  };
  const texto = achar(payload, "text/plain");
  if (texto) return texto;
  const html = achar(payload, "text/html");
  return html ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
}

async function chamar(caminho: string, token: string): Promise<Response> {
  return fetch(`${BASE}${caminho}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
}

export type ResultadoGmail<T> = { ok: true; dados: T } | { ok: false; erro: string };

export async function buscarEmails(query = "", max = 10): Promise<ResultadoGmail<EmailResumo[]>> {
  const token = await obterAccessTokenValido("google_gmail");
  if (!token) return { ok: false, erro: "gmail_nao_conectado" };

  const params = new URLSearchParams({ maxResults: String(Math.min(max, 25)) });
  if (query) params.set("q", query);

  let r: Response;
  try {
    r = await chamar(`/messages?${params.toString()}`, token);
  } catch (e) {
    return { ok: false, erro: `falha de rede: ${e instanceof Error ? e.message : "desconhecida"}` };
  }
  if (!r.ok) return { ok: false, erro: `Gmail API HTTP ${r.status}` };
  const lista = (await r.json()) as { messages?: Array<{ id: string }> };
  if (!lista.messages?.length) return { ok: true, dados: [] };

  // messages.list não devolve assunto/remetente — precisa de 1 GET por
  // mensagem (metadata, não full — mais barato, sem baixar o corpo à toa).
  const resumos: EmailResumo[] = [];
  for (const m of lista.messages) {
    try {
      const rm = await chamar(`/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, token);
      if (!rm.ok) continue;
      const j = (await rm.json()) as { id: string; snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } };
      resumos.push({
        id: j.id,
        assunto: cabecalho(j.payload?.headers, "Subject") || "(sem assunto)",
        remetente: cabecalho(j.payload?.headers, "From"),
        data: cabecalho(j.payload?.headers, "Date"),
        trecho: j.snippet ?? "",
      });
    } catch {
      // uma mensagem individual falhar não derruba a busca inteira
    }
  }
  return { ok: true, dados: resumos };
}

export async function lerEmail(idMensagem: string): Promise<ResultadoGmail<EmailCompleto>> {
  const token = await obterAccessTokenValido("google_gmail");
  if (!token) return { ok: false, erro: "gmail_nao_conectado" };

  let r: Response;
  try {
    r = await chamar(`/messages/${idMensagem}?format=full`, token);
  } catch (e) {
    return { ok: false, erro: `falha de rede: ${e instanceof Error ? e.message : "desconhecida"}` };
  }
  if (!r.ok) return { ok: false, erro: `Gmail API HTTP ${r.status}` };
  const j = (await r.json()) as { id: string; snippet?: string; payload?: ParteGmail & { headers?: Array<{ name: string; value: string }> } };

  return {
    ok: true,
    dados: {
      id: j.id,
      assunto: cabecalho(j.payload?.headers, "Subject") || "(sem assunto)",
      remetente: cabecalho(j.payload?.headers, "From"),
      data: cabecalho(j.payload?.headers, "Date"),
      trecho: j.snippet ?? "",
      corpo: extrairCorpo(j.payload).slice(0, 5000),
    },
  };
}
