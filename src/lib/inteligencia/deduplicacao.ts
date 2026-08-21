/**
 * Deduplicação de item de inteligência (Fase 13) — determinística, nunca
 * manda item pro modelo só pra saber se é repetido. Função pura, sem I/O:
 * quem chama já trouxe os itens EXISTENTES relevantes pra comparar (ver
 * inteligencia/repositorio.ts), esta função só decide.
 *
 * Sinal, em ordem (o primeiro que bater decide — nunca mistura critério):
 *   1. mesmo id_externo na MESMA fonte — já é garantido por UNIQUE(fonte_id,
 *      id_externo) no banco, mas checado aqui também pra decisão explícita.
 *   2. URL canônica igual (mesmo link, fonte diferente — ex: o mesmo vídeo
 *      linkado por dois canais/feeds).
 *   3. título normalizado igual + mesma data de publicação (mesmo dia) —
 *      cobre reposts com URL de tracking diferente.
 */

export type ItemExistenteParaDedup = { id: string; urlCanonica: string; tituloNormalizado: string; publicadoEmDia: string | null };

export function normalizarUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = ""; // remove querystring de tracking (utm_*, ?si=, etc.)
    u.hash = "";
    let s = u.toString().toLowerCase();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function normalizarTitulo(titulo: string): string {
  return titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acento
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function diaDe(dataIso: string | null): string | null {
  if (!dataIso) return null;
  const t = Date.parse(dataIso);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export function encontrarDuplicata(
  novo: { urlCanonica: string; titulo: string; publicadoEm: string | null },
  existentes: ItemExistenteParaDedup[],
): { duplicado: true; deId: string; motivo: string } | { duplicado: false } {
  const urlNova = normalizarUrl(novo.urlCanonica);
  const porUrl = existentes.find((e) => e.urlCanonica === urlNova);
  if (porUrl) return { duplicado: true, deId: porUrl.id, motivo: "mesma URL canônica" };

  const tituloNovo = normalizarTitulo(novo.titulo);
  const diaNovo = diaDe(novo.publicadoEm);
  if (tituloNovo && diaNovo) {
    const porTitulo = existentes.find((e) => e.tituloNormalizado === tituloNovo && e.publicadoEmDia === diaNovo);
    if (porTitulo) return { duplicado: true, deId: porTitulo.id, motivo: "mesmo título e data de publicação" };
  }

  return { duplicado: false };
}
