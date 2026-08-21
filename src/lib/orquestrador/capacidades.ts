import "server-only";
import { REGISTRO_FERRAMENTAS, ferramentasParaCapacidade } from "../ferramentas/registro";
import { disponibilidadeDe, type Disponibilidade } from "../ferramentas/tipos";
import type { CapacidadeDescricao } from "../modelo/provedor";

/**
 * Inventário de capacidades reais — o que o Planejador (determinístico ou
 * modelo) tem para trabalhar. Uma capacidade pode ter mais de uma Tool por
 * trás; a disponibilidade reportada aqui é a MELHOR entre elas (se qualquer
 * Tool da capacidade está DISPONIVEL, a capacidade está DISPONIVEL).
 */

const ORDEM_PRIORIDADE: Disponibilidade[] = ["DISPONIVEL", "REQUER_APROVACAO", "REQUER_CREDENCIAL", "INDISPONIVEL", "NAO_IMPLEMENTADO"];

export function listarCapacidadesDisponiveis(): CapacidadeDescricao[] {
  const porCapacidade = new Map<string, CapacidadeDescricao>();

  for (const f of REGISTRO_FERRAMENTAS) {
    const disp = disponibilidadeDe(f);
    const atual = porCapacidade.get(f.capacidade);
    if (!atual || ORDEM_PRIORIDADE.indexOf(disp) < ORDEM_PRIORIDADE.indexOf(atual.disponibilidade)) {
      porCapacidade.set(f.capacidade, { capacidade: f.capacidade, descricao: f.descricao, disponibilidade: disp });
    }
  }

  return [...porCapacidade.values()];
}

export function disponibilidadeDaCapacidade(capacidade: string): Disponibilidade {
  const ferramentas = ferramentasParaCapacidade(capacidade);
  if (ferramentas.length === 0) return "NAO_IMPLEMENTADO";
  const disponibilidades = ferramentas.map(disponibilidadeDe);
  for (const d of ORDEM_PRIORIDADE) if (disponibilidades.includes(d)) return d;
  return "NAO_IMPLEMENTADO";
}

/** A primeira Tool DISPONIVEL para a capacidade — quem chama trata REQUER_APROVACAO à parte (não conta como "disponível para rodar direto"). */
export function ferramentaDisponivelPara(capacidade: string) {
  return ferramentasParaCapacidade(capacidade).find((f) => disponibilidadeDe(f) === "DISPONIVEL");
}

export function ferramentaQueRequerAprovacao(capacidade: string) {
  return ferramentasParaCapacidade(capacidade).find((f) => disponibilidadeDe(f) === "REQUER_APROVACAO");
}
