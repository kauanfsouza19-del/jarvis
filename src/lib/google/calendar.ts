import "server-only";
import { obterAccessTokenValido } from "./oauth";

/**
 * Google Calendar API v3 real — substitui o stub `calendar.listar`/
 * `calendar.criar` da Fase 8. Sempre o calendário "primary" (o principal da
 * conta conectada) — nenhuma seleção de calendário secundário nesta fase,
 * não havia pedido real pra isso.
 */

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export type EventoResumo = { id: string; titulo: string; inicio: string; fim: string; local: string | null };
export type ResultadoCalendar<T> = { ok: true; dados: T } | { ok: false; erro: string };

export async function listarEventos(desde?: string, ate?: string): Promise<ResultadoCalendar<EventoResumo[]>> {
  const token = await obterAccessTokenValido("google_calendar");
  if (!token) return { ok: false, erro: "calendar_nao_conectado" };

  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
    timeMin: desde ?? new Date().toISOString(),
  });
  if (ate) params.set("timeMax", ate);

  let r: Response;
  try {
    r = await fetch(`${BASE}?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    return { ok: false, erro: `falha de rede: ${e instanceof Error ? e.message : "desconhecida"}` };
  }
  if (!r.ok) return { ok: false, erro: `Calendar API HTTP ${r.status}` };

  const j = (await r.json()) as {
    items?: Array<{ id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string }>;
  };
  const eventos = (j.items ?? []).map((e) => ({
    id: e.id,
    titulo: e.summary ?? "(sem título)",
    inicio: e.start?.dateTime ?? e.start?.date ?? "",
    fim: e.end?.dateTime ?? e.end?.date ?? "",
    local: e.location ?? null,
  }));
  return { ok: true, dados: eventos };
}

export async function criarEvento(entrada: { titulo: string; inicioIso: string; fimIso: string; local?: string; participantes?: string[] }): Promise<ResultadoCalendar<EventoResumo>> {
  const token = await obterAccessTokenValido("google_calendar");
  if (!token) return { ok: false, erro: "calendar_nao_conectado" };

  const corpo = {
    summary: entrada.titulo,
    start: { dateTime: entrada.inicioIso },
    end: { dateTime: entrada.fimIso },
    location: entrada.local,
    attendees: entrada.participantes?.map((email) => ({ email })),
  };

  let r: Response;
  try {
    r = await fetch(BASE, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return { ok: false, erro: `falha de rede: ${e instanceof Error ? e.message : "desconhecida"}` };
  }
  if (!r.ok) return { ok: false, erro: `Calendar API HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };

  const j = (await r.json()) as { id: string; summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string }; location?: string };
  return {
    ok: true,
    dados: { id: j.id, titulo: j.summary ?? entrada.titulo, inicio: j.start?.dateTime ?? entrada.inicioIso, fim: j.end?.dateTime ?? entrada.fimIso, local: j.location ?? null },
  };
}
