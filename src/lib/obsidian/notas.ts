import "server-only";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../dados/db";
import { higienizarTextoExterno } from "../seguranca/prompt";

/**
 * Ponte memória -> nota Obsidian (Fase 8, seção 14 — "Knowledge Feedback
 * Loop"). Fundação, NUNCA gatilho automático: nada neste arquivo chama isto
 * sozinho depois de cada resultado de job. Quem decidir promover uma
 * memória específica (um handler futuro, uma ação explícita do Cacique)
 * chama `promoverMemoriaParaObsidian(id)` — a função em si é o que garante
 * os critérios (confiança suficiente, proveniência real, não duplicado,
 * não é conversa transiente, nunca segredo) antes de escrever.
 *
 * O banco continua fonte de verdade — a nota é sempre DERIVADA de uma
 * memória que já existe lá, nunca o contrário.
 */

const RAIZ_VAULT = process.env.OBSIDIAN_VAULT_PATH ?? join(process.cwd(), "dados", "obsidian-vault");
const CONFIANCA_MINIMA = 0.6;
const CAMADAS_TRANSIENTES = new Set(["temporaria", "contexto_temp"]);

export type ResultadoPromocao =
  | { promovido: true; caminho: string }
  | { promovido: false; motivo: string };

/** Nunca escreve credencial/segredo numa nota — mesma lista de padrão usada no scanner de pre-commit, aplicada em runtime aqui. */
const PADROES_SEGREDO = [/sk-[a-zA-Z0-9]{20,}/, /api[_-]?key/i, /senha|password/i, /bearer\s+[a-zA-Z0-9._-]{10,}/i];

function contemSegredo(texto: string): boolean {
  return PADROES_SEGREDO.some((p) => p.test(texto));
}

export function promoverMemoriaParaObsidian(memoriaId: string): ResultadoPromocao {
  const m = db().prepare(`SELECT * FROM memorias WHERE id = ?`).get(memoriaId) as
    | { id: string; tipo: string; camada: string; titulo: string; corpo: string; origem: string; confianca: number; estado: string }
    | undefined;
  if (!m) return { promovido: false, motivo: "memória não encontrada" };

  if (m.estado !== "ATIVA") return { promovido: false, motivo: `memória não está ATIVA (estado: ${m.estado})` };
  if (m.confianca < CONFIANCA_MINIMA) return { promovido: false, motivo: `confiança abaixo do mínimo (${m.confianca} < ${CONFIANCA_MINIMA})` };
  if (CAMADAS_TRANSIENTES.has(m.camada)) return { promovido: false, motivo: `camada transiente (${m.camada}) — não é conhecimento reutilizável` };
  if (!m.origem || m.origem === "desconhecida") return { promovido: false, motivo: "sem proveniência registrada" };
  if (contemSegredo(m.corpo) || contemSegredo(m.titulo)) return { promovido: false, motivo: "conteúdo parece conter segredo/credencial — nunca escrito" };

  const pasta = join(RAIZ_VAULT, "02_Knowledge");
  mkdirSync(pasta, { recursive: true });
  const nomeArquivo = `${m.titulo.replace(/[\\/:*?"<>|]/g, "").slice(0, 80)}.md`;
  const caminho = join(pasta, nomeArquivo);

  if (existsSync(caminho)) return { promovido: false, motivo: "nota já existe — não sobrescreve (idempotente)" };

  const tituloSeguro = higienizarTextoExterno(m.titulo, 150);
  const corpoSeguro = higienizarTextoExterno(m.corpo, 2000);
  const conteudo = `---
tipo: conhecimento
confianca: ${m.confianca}
provenance: ${m.origem}
origem_memoria_id: ${m.id}
tipo_memoria: ${m.tipo}
---

# ${tituloSeguro}

## Fato
${corpoSeguro}

## Fonte
${m.origem}
`;
  writeFileSync(caminho, conteudo, "utf8");
  return { promovido: true, caminho };
}
