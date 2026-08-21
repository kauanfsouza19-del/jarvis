import "server-only";
import { buscarMemorias, buscarConhecimento, buscarConhecimentoProjeto } from "./dados/busca";
import { db } from "./dados/db";

/**
 * Construtor de contexto.
 *
 * Recupera só o que é relevante para ESTA pergunta. Nunca despeja o banco no
 * prompt. Cada item vai rotulado com sua origem, para o Jarvis conseguir dizer
 * "isso está na sua base" e "isso é dado de conta real" como coisas diferentes.
 */

export type Contexto = {
  bloco: string;
  memorias: Array<{ id: string; titulo: string }>;
  trechos: Array<{ id: string; afirmacao: string }>;
  resumo: string;
};

export function montarContexto(pergunta: string, projetoId?: string | null): Contexto {
  const memorias = buscarMemorias(pergunta, { projeto_id: projetoId, limite: 8 });
  const trechos = buscarConhecimento(pergunta, { limite: 8 });
  const doProjeto = projetoId ? buscarConhecimentoProjeto(pergunta, projetoId, 6) : [];

  const partes: string[] = [];

  if (projetoId) {
    const p = db()
      .prepare(`SELECT nome, proposito, resumo, permissao FROM projetos WHERE id = ?`)
      .get(projetoId) as
      | { nome: string; proposito: string; resumo: string; permissao: string }
      | undefined;
    if (p) {
      partes.push(
        `## PROJETO ATIVO: ${p.nome}\n` +
          `Propósito: ${p.proposito}\n` +
          `Permissão: ${p.permissao}\n` +
          (p.resumo ? `Resumo: ${p.resumo}\n` : ""),
      );
    }
  }

  if (memorias.length) {
    partes.push(
      `## MEMÓRIA DO CACIQUE (preferências e decisões dele — não são fatos técnicos)\n` +
        memorias
          .map(
            (m) =>
              `- [${m.tipo} · confiança ${m.confianca.toFixed(2)}] ${m.titulo}: ${m.corpo}`,
          )
          .join("\n"),
    );
  }

  if (doProjeto.length) {
    partes.push(
      `## CONHECIMENTO DO REPOSITÓRIO (fato de código — pode ter mudado desde a indexação)\n` +
        doProjeto.map((c) => `- ${c.titulo}: ${c.corpo}`).join("\n"),
    );
  }

  if (trechos.length) {
    partes.push(
      `## BASE DE CONHECIMENTO (material de estudo — NÃO é dado de conta real)\n` +
        trechos
          .map(
            (t) =>
              `- [${t.evidencia} · ${t.natureza} · fonte: ${t.fonte_titulo}] ${t.afirmacao}\n  ${t.corpo}`,
          )
          .join("\n"),
    );
  }

  if (partes.length) {
    partes.push(
      `## COMO USAR O QUE ESTÁ ACIMA\n` +
        `Dado de conta conectada vence heurística da base, sempre. Se a base disser X e a ` +
        `conta mostrar Y, apresente os dois com suas origens e recomende com base em Y. ` +
        `Nunca apresente item de MENCAO_ISOLADA como consenso. Se nada acima responder a ` +
        `pergunta, diga que não tem base para responder — não preencha a lacuna.`,
    );
  }

  return {
    bloco: partes.join("\n\n"),
    memorias: memorias.map((m) => ({ id: m.id, titulo: m.titulo })),
    trechos: trechos.map((t) => ({ id: t.id, afirmacao: t.afirmacao })),
    resumo: `${memorias.length} memória(s), ${trechos.length} trecho(s) da base, ${doProjeto.length} do repositório`,
  };
}
