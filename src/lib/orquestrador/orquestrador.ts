import "server-only";
import "../jobs/registro-handlers";
import { planejar } from "./planejador";
import { criarPlano, atualizarPlano } from "./repositorio";
import { criarJob, atualizarJob } from "../jobs/motor";
import type { ContextoResolvido } from "../contexto/resolver";
import { obterNivelAutonomia } from "../autonomia";
import { escolherAgentePorCapacidades } from "../agentes/repositorio";

/**
 * Orquestrador — objetivo em linguagem natural vira Plano persistido vira
 * Job em execução. Nunca a lógica de browser/prospecção/Google/WhatsApp
 * mora aqui — isso é responsabilidade de cada Tool, coordenada por
 * capacidade (ver capacidades.ts e o despachante em
 * jobs/handlers/plano-orquestrado.ts).
 *
 * `null` de volta significa "isto não é uma tarefa orquestrável" — quem
 * chama (rota /api/conversar) trata como conversa normal, nunca como erro.
 */

export type ResultadoOrquestrar = { jobId: string | null; planoId: string; resumoRaciocinio: string };

export async function orquestrar(conversaId: string | null, objetivo: string, resolvido: ContextoResolvido): Promise<ResultadoOrquestrar | null> {
  const candidato = await planejar(objetivo, resolvido, conversaId);
  if (!candidato) return null;

  const capacidadesNecessarias = [...new Set(candidato.passos.map((p) => p.capacidade))];
  const exigeAprovacao = candidato.passos.length > 0 && candidato.nivelRisco !== "baixo";

  // Fase 7 — fundação de seleção de Agente: o registro de Agentes deixa de
  // ser só configuração decorativa. Escolhe o ATIVO com maior sobreposição
  // de capacidade real com o que este Plano precisa; sem sobreposição,
  // agente_id fica null (nunca força um agente sem relação com o trabalho).
  const agente = escolherAgentePorCapacidades(capacidadesNecessarias);

  // Plano SEMPRE é persistido, mesmo em autonomia 0 — "só sugerir" quer
  // dizer que ele fica visível e revisável, não que ele não existe.
  const { plano } = criarPlano({
    jobId: null,
    objetivo,
    resumoRaciocinio: candidato.resumoRaciocinio,
    origem: candidato.origem,
    agenteId: agente?.id ?? null,
    capacidadesNecessarias,
    nivelRisco: candidato.nivelRisco,
    exigeAprovacao,
    passos: candidato.passos,
  });

  const nivelAutonomia = obterNivelAutonomia();
  if (nivelAutonomia === 0) {
    // Nível 0: plano fica em RASCUNHO, nenhum Job é criado/disparado. É
    // decidido aqui — política de orquestração, não do motor de execução.
    return { jobId: null, planoId: plano.id, resumoRaciocinio: candidato.resumoRaciocinio };
  }

  // Job criado DEPOIS do plano, já com o planoId certo — nunca dispara com
  // parâmetro vazio esperando uma correção posterior.
  const { job } = criarJob(conversaId, "plano_orquestrado", { planoId: plano.id });
  atualizarPlano(plano.id, { job_id: job.id, estado: "APROVADO" });
  if (agente) atualizarJob(job.id, { agente_id: agente.id });

  return { jobId: job.id, planoId: plano.id, resumoRaciocinio: candidato.resumoRaciocinio };
}
