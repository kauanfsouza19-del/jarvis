import type { PlanoProposto, InterpretacaoResultado, DecisaoProximoPasso } from "./provedor";

/**
 * Validação da saída do modelo — funções puras, sem dependência de rede nem
 * de `server-only`, de propósito: resposta de modelo é texto não confiável
 * até passar por aqui, e "não confiável" nunca vira Plano/decisão real sem
 * validação — nunca aceita porque "parece certo o suficiente".
 *
 * Separado de anthropic.ts para poder ser testado direto (sem servidor de
 * pé, sem chave de API) contra um `bruto` fabricado no teste — é assim que
 * "plano malformado do modelo é rejeitado" é verificado de verdade, e não
 * só assumido.
 */

export function validarPlanoProposto(v: unknown): PlanoProposto {
  if (typeof v !== "object" || v === null) throw new Error("plano do modelo não é um objeto");
  const o = v as Record<string, unknown>;
  if (typeof o.resumoRaciocinio !== "string") throw new Error("plano sem resumoRaciocinio");
  if (!Array.isArray(o.passos)) throw new Error("plano sem passos (array)");
  const nivelRisco = o.nivelRisco === "medio" || o.nivelRisco === "alto" ? o.nivelRisco : "baixo";

  const passos = o.passos.map((p, i) => {
    if (typeof p !== "object" || p === null) throw new Error(`passo ${i} não é objeto`);
    const po = p as Record<string, unknown>;
    if (typeof po.descricao !== "string") throw new Error(`passo ${i} sem descricao`);
    if (typeof po.capacidade !== "string") throw new Error(`passo ${i} sem capacidade`);
    const dependeDe = Array.isArray(po.dependeDe) ? po.dependeDe.filter((x): x is number => typeof x === "number") : [];
    return { descricao: po.descricao, capacidade: po.capacidade, entrada: po.entrada ?? {}, dependeDe };
  });

  return { resumoRaciocinio: o.resumoRaciocinio, passos, nivelRisco };
}

export function validarInterpretacao(v: unknown): InterpretacaoResultado {
  if (typeof v !== "object" || v === null) throw new Error("interpretação não é objeto");
  const o = v as Record<string, unknown>;
  const classificacoesValidas = ["SUCESSO_REAL", "FALHA_EXECUCAO", "RESULTADO_VAZIO_VALIDO"];
  if (typeof o.classificacao !== "string" || !classificacoesValidas.includes(o.classificacao)) {
    throw new Error("classificação inválida");
  }
  return { classificacao: o.classificacao as InterpretacaoResultado["classificacao"], resumo: String(o.resumo ?? "") };
}

export function validarDecisao(v: unknown): DecisaoProximoPasso {
  if (typeof v !== "object" || v === null) throw new Error("decisão não é objeto");
  const o = v as Record<string, unknown>;
  const acoesValidas = ["CONTINUAR", "RETENTAR", "PULAR", "ADAPTAR_PLANO", "PEDIR_APROVACAO", "ENCERRAR"];
  if (typeof o.acao !== "string" || !acoesValidas.includes(o.acao)) throw new Error("ação inválida");
  return { acao: o.acao, motivo: String(o.motivo ?? "") } as DecisaoProximoPasso;
}

export type ResultadoValidacaoSemantica = { valido: boolean; problemas: string[] };

/**
 * Validação SEMÂNTICA (Fase 9) — vem depois da de esquema (funções acima).
 * Um plano pode ter o FORMATO certo (passa validarPlanoProposto) e ainda
 * assim inventar uma capacidade que não existe em lugar nenhum do sistema —
 * o prompt de gerarPlano já pede pra nunca fazer isso, mas resposta de
 * modelo é texto não confiável até prova em contrário, então provamos aqui.
 *
 * `capacidadesConhecidas` é passado pelo CHAMADOR (já tem a lista real —
 * ver orquestrador/capacidades.ts:listarCapacidadesDisponiveis) — este
 * arquivo continua puro, sem tocar em `server-only` nem no registro de
 * Tools diretamente, pra continuar testável sem servidor de pé.
 */
export function validarSemanticaPlano(plano: PlanoProposto, capacidadesConhecidas: string[]): ResultadoValidacaoSemantica {
  const problemas: string[] = [];
  const conhecidas = new Set(capacidadesConhecidas);

  if (plano.passos.length === 0) problemas.push("plano sem nenhum passo");

  plano.passos.forEach((p, i) => {
    if (!conhecidas.has(p.capacidade)) {
      problemas.push(`passo ${i}: capacidade "${p.capacidade}" não existe no sistema (alucinação — nunca foi registrada em nenhuma Tool)`);
    }
    for (const dep of p.dependeDe) {
      if (dep < 0 || dep >= plano.passos.length || dep === i) {
        problemas.push(`passo ${i}: dependeDe aponta para índice inválido (${dep})`);
      }
    }
  });

  return { valido: problemas.length === 0, problemas };
}
