import type { ConfigServidorMcp } from "./cliente";

/**
 * Registro de servidores MCP (Fase 26) — allowlist explícita, nunca
 * comando/args aceitos de texto do modelo/plano diretamente. Mesmo
 * princípio de segurança do resto do sistema (ferramentas/registro.ts,
 * agentes/repositorio.ts): quem chama pede por um ID conhecido, nunca
 * monta o comando a executar.
 *
 * Só UM servidor registrado nesta fase — o servidor de referência
 * "Everything" (mantido pelos mantenedores oficiais do MCP), usado aqui
 * como prova de conexão real, não como capacidade operacional (é um
 * servidor de demonstração/teste do próprio protocolo, não faz sentido
 * pro Jarvis usar em produção). Registrar servidores REAIS e úteis
 * (filesystem, git, etc.) é o próximo passo, deliberadamente não feito
 * agora — cada um precisa da mesma avaliação de segurança/valor real que
 * qualquer Tool nova, nunca instalado só por existir (ver
 * docs/REFERENCIA-EXPANSAO.md).
 */
export type ServidorMcpRegistro = {
  id: string;
  nome: string;
  descricao: string;
  config: ConfigServidorMcp;
};

export const SERVIDORES_MCP: ServidorMcpRegistro[] = [
  {
    id: "everything-referencia",
    nome: "Everything (referência MCP)",
    descricao: "Servidor de referência oficial do protocolo MCP — usado pra verificar que a conexão real funciona, não uma capacidade operacional do Jarvis.",
    config: { comando: "npx", args: ["-y", "@modelcontextprotocol/server-everything", "stdio"], timeoutMs: 25_000 },
  },
];

export function obterServidorMcp(id: string): ServidorMcpRegistro | undefined {
  return SERVIDORES_MCP.find((s) => s.id === id);
}
