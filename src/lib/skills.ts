/**
 * Registro de skills — o que o Jarvis sabe fazer, e o que está realmente
 * conectado hoje.
 *
 * Estático de propósito nesta fase: a lista de capacidades é conhecida em
 * tempo de build, e cada `conectado` reflete uma condição real (chave
 * presente, tabela existe, indexação rodou) — nunca um valor fixo em `true`
 * para parecer mais pronto do que está. Skill sem integração aparece como
 * "NÃO CONECTADA", nunca escondida e nunca fingindo funcionar.
 */

export type CategoriaSkill =
  | "conhecimento"
  | "memoria"
  | "criativo"
  | "documento"
  | "agenda"
  | "email"
  | "marketing"
  | "operacao"
  | "pesquisa";

export type Skill = {
  id: string;
  nome: string;
  categoria: CategoriaSkill;
  descricao: string;
  /** Verdadeiro só quando a condição real (env, tabela, índice) está satisfeita. */
  conectado: boolean;
  motivoDesconectado?: string;
};

export function construirRegistroSkills(saude: {
  modelo: boolean;
  conhecimentoProjeto: number;
}): Skill[] {
  return [
    {
      id: "memoria",
      nome: "Memória",
      categoria: "memoria",
      descricao: "Preferências, decisões e lições persistidas do Cacique.",
      conectado: true,
    },
    {
      id: "conhecimento_projeto",
      nome: "Conhecimento de projeto",
      categoria: "conhecimento",
      descricao: "Busca FTS/BM25 sobre Locatta, Marketing e Clientes indexados.",
      conectado: saude.conhecimentoProjeto > 0,
      motivoDesconectado: "nenhum projeto indexado ainda",
    },
    {
      id: "conversa",
      nome: "Conversa com modelo",
      categoria: "operacao",
      descricao: "Resposta gerada pelo Claude com o contexto recuperado.",
      conectado: saude.modelo,
      motivoDesconectado: "ANTHROPIC_API_KEY não configurada",
    },
    {
      id: "contexto",
      nome: "Resolução de contexto",
      categoria: "operacao",
      descricao: "Infere projeto, cliente, intenção e modo a partir da mensagem.",
      conectado: true,
    },
    {
      id: "email",
      nome: "E-mail",
      categoria: "email",
      descricao: "Classificação e priorização de caixa de entrada.",
      conectado: false,
      motivoDesconectado: "nenhuma conta autorizada",
    },
    {
      id: "agenda",
      nome: "Agenda",
      categoria: "agenda",
      descricao: "Leitura e raciocínio sobre compromissos do dia.",
      conectado: false,
      motivoDesconectado: "nenhum calendário autorizado",
    },
    {
      id: "pesquisa_web",
      nome: "Pesquisa web",
      categoria: "pesquisa",
      descricao: "Navegação e extração de páginas públicas.",
      conectado: false,
      motivoDesconectado: "ferramenta ainda não implementada",
    },
    {
      id: "google_ads",
      nome: "Google Ads",
      categoria: "marketing",
      descricao: "Leitura de campanhas, negativação, auditoria de conta.",
      conectado: false,
      motivoDesconectado: "conta não conectada",
    },
    {
      id: "meta_ads",
      nome: "Meta Ads",
      categoria: "marketing",
      descricao: "Leitura de campanhas e biblioteca de anúncios.",
      conectado: false,
      motivoDesconectado: "conta não conectada",
    },
    {
      id: "criativo",
      nome: "Produção criativa",
      categoria: "criativo",
      descricao: "Pesquisa → ângulo → hook → roteiro → criativo → teste.",
      conectado: false,
      motivoDesconectado: "depende do modelo conectado",
    },
    {
      id: "documento",
      nome: "Documentos",
      categoria: "documento",
      descricao: "Leitura de PDF/DOCX anexado — hoje só nome, tipo e tamanho.",
      conectado: false,
      motivoDesconectado: "extração de conteúdo binário ainda não implementada",
    },
  ];
}
