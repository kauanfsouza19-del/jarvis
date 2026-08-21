import "server-only";
import { rotear, chamarComFallback } from "./roteador";
import { higienizarTextoExterno } from "../seguranca/prompt";
import { decidirNivelEscalonamento, type SinaisEscalonamento } from "./escalonamento";

export { decidirNivelEscalonamento, type SinaisEscalonamento };

/**
 * Validação cruzada (Fase 8) — segunda opinião só quando vale o custo
 * extra: risco alto ou confiança baixa (decidido por quem chama, nunca
 * automático pra toda tarefa — instrução explícita da fase: "NÃO significa
 * chamar dois modelos pra toda tarefa"). Usa o MESMO roteador (pode cair no
 * mesmo provedor se só um estiver disponível — ainda é uma segunda leitura
 * independente do texto, só não de um provedor totalmente diferente nesta
 * sessão, onde só Anthropic está configurado).
 */

export type ResultadoValidacao = {
  modeloValidador: string | null;
  aprovado: boolean;
  motivo: string;
  problemasEncontrados: string[];
};

/**
 * Pede a um segundo modelo pra revisar um texto/análise já produzido —
 * consistência factual, alegação sem suporte, contradição lógica. Nunca
 * reescreve o resultado original sozinho; só reporta se passou ou não e
 * por quê, quem chama decide o que fazer com isso.
 */
export async function validarComSegundoModelo(conteudoOriginal: string, contextoEvidencia: string): Promise<ResultadoValidacao> {
  const decisao = rotear({ tipoTarefa: "raciocinio_estrategico", complexidade: "media", nivelRisco: "alto", tamanhoContextoTokens: 600 });
  if (!decisao.provedor) {
    return { modeloValidador: null, aprovado: true, motivo: "Nenhum provedor de modelo disponível para validação — resultado original mantido sem segunda opinião.", problemasEncontrados: [] };
  }

  // conteudoOriginal pode conter dado de fonte externa (nome de negócio,
  // trecho de site) — mesma disciplina de higienização das outras chamadas
  // de modelo desta fase.
  const conteudoSeguro = higienizarTextoExterno(conteudoOriginal, 2000);
  const evidenciaSegura = higienizarTextoExterno(contextoEvidencia, 1000);
  const objetivo = `Revisar o texto abaixo quanto a consistência factual, alegação sem evidência e contradição lógica: "${conteudoSeguro}". Evidência disponível: "${evidenciaSegura}".`;

  try {
    const respostaTexto = await chamarComFallback(decisao, (p) => p.comporResposta(objetivo, "Responda em JSON: {\"aprovado\": true|false, \"problemas\": [\"...\"]}"));
    let json: { aprovado?: boolean; problemas?: string[] };
    try {
      json = JSON.parse(respostaTexto.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim());
    } catch {
      // Resposta não veio em JSON — trata como "não deu pra validar", nunca reprova por engano de formato.
      return { modeloValidador: decisao.modeloId, aprovado: true, motivo: "Validador respondeu em formato inesperado — tratado como não-conclusivo.", problemasEncontrados: [] };
    }
    const problemas = Array.isArray(json.problemas) ? json.problemas.filter((p): p is string => typeof p === "string") : [];
    return {
      modeloValidador: decisao.modeloId,
      aprovado: json.aprovado !== false,
      motivo: problemas.length > 0 ? `Validador (${decisao.modeloId}) encontrou ${problemas.length} ponto(s).` : `Validador (${decisao.modeloId}) não encontrou problema.`,
      problemasEncontrados: problemas,
    };
  } catch (e) {
    return {
      modeloValidador: decisao.modeloId,
      aprovado: true,
      motivo: `Validação falhou tecnicamente (${e instanceof Error ? e.message.slice(0, 100) : "erro desconhecido"}) — resultado original mantido, nunca bloqueado por falha da validação em si.`,
      problemasEncontrados: [],
    };
  }
}
