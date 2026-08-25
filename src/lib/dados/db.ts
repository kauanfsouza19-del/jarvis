import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DDL, VERSAO_ESQUEMA } from "./esquema";

const CAMINHO = process.env.JARVIS_DB ?? join(process.cwd(), "dados", "jarvis.db");

let instancia: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (instancia) return instancia;

  mkdirSync(dirname(CAMINHO), { recursive: true });
  const d = new DatabaseSync(CAMINHO);
  d.exec(DDL);
  migrar(d);

  const atual = d
    .prepare("SELECT MAX(versao) AS v FROM esquema_versao")
    .get() as { v: number | null } | undefined;

  if (!atual?.v) {
    d.prepare("INSERT INTO esquema_versao (versao) VALUES (?)").run(VERSAO_ESQUEMA);
    semear(d);
  }

  instancia = d;
  return d;
}

/**
 * Migração idempotente por coluna — mais simples que um framework de migração
 * para um schema deste tamanho. `CREATE TABLE IF NOT EXISTS` não adiciona
 * coluna a tabela que já existe, então quando o motor de contexto passou a
 * precisar de campos novos em `mensagens`, isso teve que entrar aqui.
 */
function migrar(d: DatabaseSync) {
  const colunas = new Set(
    (d.prepare("PRAGMA table_info(mensagens)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
  const novas: Array<[string, string]> = [
    ["cliente_nome", "TEXT"],
    ["intencao", "TEXT"],
    ["confianca_contexto", "TEXT"],
  ];
  for (const [nome, tipo] of novas) {
    if (!colunas.has(nome)) {
      d.exec(`ALTER TABLE mensagens ADD COLUMN ${nome} ${tipo}`);
    }
  }

  // execucoes -> jobs: renomeado quando o motor de job foi generalizado.
  // "CREATE TABLE IF NOT EXISTS jobs" já rodou (é o DDL, executado antes
  // desta função) e criou a tabela nova vazia — aqui só existe trabalho se
  // sobrou alguma linha na tabela antiga. Copia antes de derrubar: nunca
  // perde um job silenciosamente, mesmo numa migração.
  const existeExecucoesAntiga = d
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='execucoes'")
    .get();
  if (existeExecucoesAntiga) {
    // Vocabulário de status mudou (execução → job): CONCLUIDA/BLOQUEADA
    // (feminino, combinava com "execução") viram CONCLUIDO/BLOQUEADO
    // (masculino, combina com "job"). Achado rodando esta migração contra o
    // banco de verdade: uma linha de teste sobrevivente com status
    // CONCLUIDA quebrou a CHECK constraint nova — cópia direta não bastava.
    d.exec(
      `INSERT INTO jobs (id, conversa_id, tipo, parametros, status, progresso_atual,
                          progresso_total, etapa, resultado_id, erro, criado_em, iniciado_em, concluido_em)
       SELECT id, conversa_id, tipo, parametros,
              CASE status WHEN 'CONCLUIDA' THEN 'CONCLUIDO' WHEN 'BLOQUEADA' THEN 'BLOQUEADO' ELSE status END,
              progresso_atual, progresso_total, etapa, resultado_id, erro, criado_em, iniciado_em, concluido_em
         FROM execucoes WHERE id NOT IN (SELECT id FROM jobs)`,
    );
    d.exec("DROP TABLE execucoes");
  }

  // `resultados.execucao_id` referenciava `execucoes(id)` — CREATE TABLE IF
  // NOT EXISTS não atualiza FK de tabela que já existe, então mudar o texto
  // do schema sozinho não bastava: a tabela antiga em disco continuava
  // presa a uma FOREIGN KEY para uma tabela que a migração acima acabou de
  // derrubar. Achado rodando de verdade — todo INSERT em `resultados`
  // falhava com "no such table: main.execucoes".
  //
  // Achado rodando de verdade PELA SEGUNDA VEZ, na primeira tentativa de
  // correção: `ALTER TABLE resultados RENAME TO x` reescreve sozinho, como
  // efeito colateral documentado do SQLite, a FK de QUALQUER outra tabela
  // que referencie `resultados` — `resultado_prospects` e `arquivos_gerados`
  // passaram a apontar pra `x`, e quando `x` foi derrubada, ficaram
  // referenciando uma tabela inexistente. A ordem abaixo evita o problema:
  // nunca renomeia a tabela ANTIGA (RENAME é o gatilho da reescrita), só
  // cria a nova sob nome temporário, copia, derruba a antiga (DROP não
  // reescreve nada) e só então renomeia a nova para o nome definitivo —
  // nesse momento os filhos já apontam pro nome certo havia o tempo todo.
  const sqlResultados = (
    d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='resultados'").get() as
      | { sql: string }
      | undefined
  )?.sql;
  if (sqlResultados?.includes("execucoes(id)")) {
    d.exec(`
      CREATE TABLE resultados_nova (
        id           TEXT PRIMARY KEY,
        execucao_id  TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        tipo         TEXT NOT NULL,
        resumo       TEXT NOT NULL,
        criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    d.exec(`INSERT INTO resultados_nova SELECT id, execucao_id, tipo, resumo, criado_em FROM resultados`);
    d.exec("DROP TABLE resultados");
    d.exec("ALTER TABLE resultados_nova RENAME TO resultados");
  }

  // Reparo do dano colateral descrito acima, para quem já rodou a migração
  // quebrada uma vez (inclusive este banco, nesta sessão): reconstrói as
  // duas tabelas filhas com a MESMA técnica seção-nova → copia → derruba →
  // renomeia, sempre que a FK gravada não apontar mais para "resultados".
  for (const [tabela, colunas, criar] of [
    [
      "resultado_prospects",
      "resultado_id, prospect_id, ordem",
      `CREATE TABLE resultado_prospects_nova (
         resultado_id TEXT NOT NULL REFERENCES resultados(id) ON DELETE CASCADE,
         prospect_id  TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
         ordem        INTEGER NOT NULL,
         PRIMARY KEY (resultado_id, prospect_id)
       )`,
    ],
    [
      "arquivos_gerados",
      "id, resultado_id, tipo, nome, mime_type, tamanho_bytes, caminho, criado_em",
      `CREATE TABLE arquivos_gerados_nova (
         id           TEXT PRIMARY KEY,
         resultado_id TEXT NOT NULL REFERENCES resultados(id) ON DELETE CASCADE,
         tipo         TEXT NOT NULL CHECK (tipo IN ('csv','xlsx')),
         nome         TEXT NOT NULL,
         mime_type    TEXT NOT NULL,
         tamanho_bytes INTEGER NOT NULL,
         caminho      TEXT NOT NULL,
         criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    ],
  ] as const) {
    const sqlAtual = (
      d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(tabela) as
        | { sql: string }
        | undefined
    )?.sql;
    if (sqlAtual && !/REFERENCES\s+"?resultados"?\s*\(/i.test(sqlAtual)) {
      d.exec(criar);
      d.exec(`INSERT INTO ${tabela}_nova SELECT ${colunas} FROM ${tabela}`);
      d.exec(`DROP TABLE ${tabela}`);
      d.exec(`ALTER TABLE ${tabela}_nova RENAME TO ${tabela}`);
    }
  }

  // plano_passos.status ganhou AGUARDANDO_FINALIZACAO depois que rodar o
  // Orquestrador de verdade revelou um loop infinito: o passo especial
  // gerar_arquivo_resultado voltava pra PENDENTE pra "esperar a
  // finalização", mas PENDENTE é exatamente o status que passosProntos()
  // usa pra decidir o que rodar de novo — o mesmo passo virava "pronto"
  // pra sempre e travava o processo inteiro (toda a API, não só o job).
  // CREATE TABLE IF NOT EXISTS não atualiza CHECK de tabela que já existe,
  // então quem já criou plano_passos antes desta correção precisa migrar.
  const sqlPlanoPassos = (
    d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='plano_passos'").get() as
      | { sql: string }
      | undefined
  )?.sql;
  if (sqlPlanoPassos && !sqlPlanoPassos.includes("AGUARDANDO_FINALIZACAO")) {
    d.exec(`
      CREATE TABLE plano_passos_nova (
        id                 TEXT PRIMARY KEY,
        plano_id           TEXT NOT NULL REFERENCES planos(id) ON DELETE CASCADE,
        ordem              INTEGER NOT NULL,
        descricao          TEXT NOT NULL,
        capacidade         TEXT NOT NULL,
        entrada            TEXT NOT NULL,
        depende_de         TEXT NOT NULL DEFAULT '[]',
        nivel_permissao    TEXT,
        status             TEXT NOT NULL DEFAULT 'PENDENTE'
                           CHECK (status IN ('PENDENTE','EXECUTANDO','CONCLUIDO','FALHOU','PULADO','AGUARDANDO_APROVACAO','AGUARDANDO_FINALIZACAO')),
        saida              TEXT,
        erro               TEXT,
        tentativas         INTEGER NOT NULL DEFAULT 0,
        max_tentativas     INTEGER NOT NULL DEFAULT 1,
        iniciado_em        TEXT,
        concluido_em       TEXT
      )`);
    d.exec(`INSERT INTO plano_passos_nova SELECT * FROM plano_passos`);
    d.exec("DROP TABLE plano_passos");
    d.exec("ALTER TABLE plano_passos_nova RENAME TO plano_passos");
    d.exec("CREATE INDEX IF NOT EXISTS idx_plano_passos_plano ON plano_passos(plano_id, ordem)");
  }

  // prospects ganhou classificacao_oportunidade/confianca_pontuacao (motor
  // de score explicável — HOT/HIGH/MEDIUM/LOW/UNKNOWN + confiança separada
  // do score). SQLite não deixa ADD COLUMN levar CHECK, então a validação
  // do vocabulário fechado fica só no código (pontuacao.ts), não no schema,
  // pra quem migra de um banco antigo — mesmo trade-off que outras colunas
  // adicionadas via ADD COLUMN nesta função.
  const colunasProspects = new Set(
    (d.prepare("PRAGMA table_info(prospects)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!colunasProspects.has("classificacao_oportunidade")) {
    d.exec("ALTER TABLE prospects ADD COLUMN classificacao_oportunidade TEXT");
  }
  if (!colunasProspects.has("confianca_pontuacao")) {
    d.exec("ALTER TABLE prospects ADD COLUMN confianca_pontuacao TEXT");
  }

  // resultados ganhou linhagem de resultado derivado (parent_result_id/
  // operacao/metadados_transformacao) — CREATE TABLE IF NOT EXISTS não
  // adiciona coluna em tabela que já existe, então quem já tinha jobs
  // rodados antes desta fase precisa migrar. Colunas novas são todas
  // opcionais (resultado raiz de descoberta não tem pai), então ADD COLUMN
  // simples resolve sem precisar do dança criar->copiar->derrubar->renomear.
  const colunasResultados = new Set(
    (d.prepare("PRAGMA table_info(resultados)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!colunasResultados.has("parent_result_id")) {
    d.exec("ALTER TABLE resultados ADD COLUMN parent_result_id TEXT REFERENCES resultados(id) ON DELETE SET NULL");
  }
  if (!colunasResultados.has("operacao")) {
    d.exec("ALTER TABLE resultados ADD COLUMN operacao TEXT");
  }
  if (!colunasResultados.has("metadados_transformacao")) {
    d.exec("ALTER TABLE resultados ADD COLUMN metadados_transformacao TEXT");
  }
  d.exec("CREATE INDEX IF NOT EXISTS idx_resultados_parent ON resultados(parent_result_id)");

  // prospect_evidencias ganhou `status` (encontrado/nao_encontrado/
  // nao_verificado/inconclusivo) — antes disso, "não achei o campo" e
  // "nunca verifiquei esse campo" eram indistinguíveis (nenhuma linha em
  // nenhum dos dois casos). CHECK constraint em coluna nova não é
  // garantido pelo ADD COLUMN do SQLite, então usa o mesmo padrão de
  // recriar->copiar->derrubar->renomear já usado nesta função — não há
  // tabela nenhuma com FK apontando pra prospect_evidencias, então é seguro.
  const sqlEvidencias = (
    d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='prospect_evidencias'").get() as
      | { sql: string }
      | undefined
  )?.sql;
  if (sqlEvidencias && !sqlEvidencias.includes("nao_verificado")) {
    d.exec(`
      CREATE TABLE prospect_evidencias_nova (
        id           TEXT PRIMARY KEY,
        prospect_id  TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
        campo        TEXT NOT NULL,
        valor        TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'encontrado'
                     CHECK (status IN ('encontrado','nao_encontrado','nao_verificado','inconclusivo')),
        fonte        TEXT NOT NULL,
        confianca    TEXT NOT NULL CHECK (confianca IN ('alta','media','baixa')),
        coletado_em  TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    d.exec(
      `INSERT INTO prospect_evidencias_nova (id, prospect_id, campo, valor, status, fonte, confianca, coletado_em)
       SELECT id, prospect_id, campo, valor, 'encontrado', fonte, confianca, coletado_em FROM prospect_evidencias`,
    );
    d.exec("DROP TABLE prospect_evidencias");
    d.exec("ALTER TABLE prospect_evidencias_nova RENAME TO prospect_evidencias");
    d.exec("CREATE INDEX IF NOT EXISTS idx_prospect_evidencias_prospect ON prospect_evidencias(prospect_id, campo, coletado_em DESC)");
  }

  // Agente de prospecção — prova real de que o registro de Agente não é
  // decoração vazia: é exatamente o papel que o planejador determinístico
  // de prospecção já exercita hoje, só que agora com identidade persistida
  // e consultável. `semear()` só roda em banco novo; isto cobre o banco que
  // já existia antes do registro de Agente ser criado.
  const semAgentes = (d.prepare("SELECT COUNT(*) n FROM agentes").get() as { n: number }).n === 0;
  if (semAgentes) {
    d.prepare(
      `INSERT INTO agentes (id, nome, papel, objetivo, capacidades, instrucoes, nivel_autonomia_padrao)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(
      crypto.randomUUID(),
      "Agente de Prospecção",
      "prospeccao",
      "Encontrar e diagnosticar prospects de negócio local por vertical e cidade.",
      JSON.stringify(["descobrir_negocios", "diagnosticar_prospect", "gerar_arquivo_resultado"]),
      "Nunca inventa negócio — sem descoberta automática disponível, trabalha só com prospects já cadastrados e diz isso.",
      1,
    );
  }

  // Papéis especializados da esteira comercial (Fase "Pesquisa -> Prospecção
  // -> Enriquecimento -> Qualificação -> Abordagem") — configuração
  // persistida, cada um com as capacidades REAIS que já existem no registro
  // de Ferramentas. O Orquestrador continua sendo a autoridade: um Agente
  // aqui é rótulo + fronteira de capacidade, nunca um segundo motor de
  // execução. `agentePorPapel()` é quem consulta isto; nenhum destes papéis
  // é referenciado por planejador nenhum ainda além de 'prospeccao' — eles
  // ficam prontos pro planejador escolher no futuro, sem inventar execução
  // que não existe hoje (ver relatório da fase).
  const papeisExistentes = new Set(
    (d.prepare("SELECT papel FROM agentes").all() as Array<{ papel: string }>).map((a) => a.papel),
  );
  const papeisNovos: Array<[string, string, string, string[], string]> = [
    [
      "Agente de Pesquisa",
      "pesquisa",
      "Pesquisar informação pública na web sobre um negócio ou tema.",
      ["pesquisar_web", "visitar_site"],
      "Só usa fonte pública e permitida — nunca contorna login, CAPTCHA ou paywall.",
    ],
    [
      "Agente de Enriquecimento",
      "enriquecimento",
      "Coletar telefone, WhatsApp, e-mail, Instagram e Facebook públicos de um prospect a partir do site dele.",
      ["enriquecer_prospect"],
      "Todo campo coletado carrega fonte e confiança — nunca inventa contato que não está publicamente visível.",
    ],
    [
      "Agente de Análise de Marketing",
      "analise_marketing",
      "Avaliar sinais reais de operação de marketing digital (pixel, GTM, GA4, e-commerce) de um prospect.",
      ["analisar_marketing_digital"],
      "Usa 'detectado/não detectado/inconclusivo' — nunca afirma certeza que a evidência não sustenta.",
    ],
    [
      "Agente de Qualificação de Lead",
      "qualificacao",
      "Pontuar e classificar oportunidade (HOT/HIGH/MEDIUM/LOW/UNKNOWN) a partir do que foi observado.",
      ["pontuar_prospect"],
      "Score é determinístico e explicável — nunca otimiza só por quantidade de lead.",
    ],
    [
      "Agente de Abordagem (SDR)",
      "abordagem",
      "Gerar mensagem de abordagem comercial personalizada a partir da evidência real de cada lead.",
      ["gerar_abordagem"],
      "Nunca envia nada — só gera texto. Nunca é mensagem genérica: usa a dor observada de cada lead.",
    ],
    [
      // Fase 11 — Social Media Operating System.
      "Agente de Conteúdo Social",
      "conteudo_social",
      "Gerar rascunho de conteúdo (legenda, hashtags, CTA) para Instagram e outras redes, a partir de um tema.",
      ["gerar_conteudo_social"],
      "Nunca publica nada — só gera rascunho. Todo conteúdo nasce em RASCUNHO e precisa de aprovação explícita antes de agendar.",
    ],
  ];
  const inserirAgente = d.prepare(
    `INSERT INTO agentes (id, nome, papel, objetivo, capacidades, instrucoes, nivel_autonomia_padrao)
     VALUES (?,?,?,?,?,?,?)`,
  );
  for (const [nome, papel, objetivo, capacidades, instrucoes] of papeisNovos) {
    if (papeisExistentes.has(papel)) continue;
    inserirAgente.run(crypto.randomUUID(), nome, papel, objetivo, JSON.stringify(capacidades), instrucoes, 1);
  }

  // Fase 6 — Web Research & Lead Intelligence: prospects ganha bairro/
  // endereço (dado estruturado do site, nunca regex livre — ver
  // pesquisa/navegador.ts) e o bloco de contato (nome/cargo/fonte/confiança/
  // status). Vocabulário fechado de status (OWNER_VERIFIED/OWNER_CLAIMED/
  // PUBLIC_CONTACT/TEAM_MEMBER/UNVERIFIED_PERSON/UNKNOWN) validado só no
  // código (prospeccao/inteligencia.ts), mesmo trade-off de ADD COLUMN sem
  // CHECK já usado nesta função pras outras colunas.
  const colunasProspects6 = new Set(
    (d.prepare("PRAGMA table_info(prospects)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  const novasColunasProspects: Array<[string, string]> = [
    ["bairro", "TEXT"],
    ["endereco", "TEXT"],
    ["contato_nome", "TEXT"],
    ["contato_cargo", "TEXT"],
    ["contato_fonte", "TEXT"],
    ["contato_confianca", "TEXT"],
    ["contato_status", "TEXT"],
  ];
  for (const [nome, tipo] of novasColunasProspects) {
    if (!colunasProspects6.has(nome)) d.exec(`ALTER TABLE prospects ADD COLUMN ${nome} ${tipo}`);
  }

  // prospect_evidencias ganha o status 'conflitante' — quando duas fontes
  // públicas discordam sobre o MESMO campo (ex: telefone do OSM ≠ telefone
  // do site), a Fase 6 nunca escolhe uma calada: grava conflitante e expõe
  // as duas. CHECK novo em coluna existente exige o mesmo padrão recriar->
  // copiar->derrubar->renomear já usado nesta função para o mesmo motivo.
  const sqlEvidencias6 = (
    d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='prospect_evidencias'").get() as
      | { sql: string }
      | undefined
  )?.sql;
  if (sqlEvidencias6 && !sqlEvidencias6.includes("conflitante")) {
    d.exec(`
      CREATE TABLE prospect_evidencias_nova2 (
        id           TEXT PRIMARY KEY,
        prospect_id  TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
        campo        TEXT NOT NULL,
        valor        TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'encontrado'
                     CHECK (status IN ('encontrado','nao_encontrado','nao_verificado','inconclusivo','conflitante')),
        fonte        TEXT NOT NULL,
        confianca    TEXT NOT NULL CHECK (confianca IN ('alta','media','baixa')),
        coletado_em  TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    d.exec(
      `INSERT INTO prospect_evidencias_nova2 (id, prospect_id, campo, valor, status, fonte, confianca, coletado_em)
       SELECT id, prospect_id, campo, valor, status, fonte, confianca, coletado_em FROM prospect_evidencias`,
    );
    d.exec("DROP TABLE prospect_evidencias");
    d.exec("ALTER TABLE prospect_evidencias_nova2 RENAME TO prospect_evidencias");
    d.exec("CREATE INDEX IF NOT EXISTS idx_prospect_evidencias_prospect ON prospect_evidencias(prospect_id, campo, coletado_em DESC)");
  }

  // Papel de Pesquisa de Instagram — capacidade nova, config-only (mesmo
  // padrão dos outros papéis acima).
  const temPapelInstagram = (d.prepare("SELECT COUNT(*) n FROM agentes WHERE papel = 'pesquisa_instagram'").get() as { n: number }).n > 0;
  if (!temPapelInstagram) {
    d.prepare(
      `INSERT INTO agentes (id, nome, papel, objetivo, capacidades, instrucoes, nivel_autonomia_padrao)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(
      crypto.randomUUID(),
      "Agente de Pesquisa de Instagram",
      "pesquisa_instagram",
      "Coletar sinal público de perfil de Instagram de um prospect, quando acessível sem login.",
      JSON.stringify(["pesquisar_instagram"]),
      "Nunca contorna login/CAPTCHA. Bloqueio de acesso vira NAO_VERIFICADO, nunca 'sem Instagram'.",
      1,
    );
  }

  // Fase 7 — Jobs como núcleo operacional: prioridade (CRITICAL/HIGH/
  // NORMAL/LOW, validado só no código — mesmo trade-off de ADD COLUMN sem
  // CHECK já usado nesta função), custo real acumulado, qual Tool/Agente
  // respondeu pelo job, e pausa cooperativa (mesmo padrão de
  // cancelamento_solicitado, mas suspende em vez de encerrar).
  const colunasJobs7 = new Set((d.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>).map((c) => c.name));
  const novasColunasJobs: Array<[string, string]> = [
    ["prioridade", "TEXT NOT NULL DEFAULT 'NORMAL'"],
    ["custo_usd", "REAL NOT NULL DEFAULT 0"],
    ["ferramenta_usada", "TEXT"],
    ["agente_id", "TEXT REFERENCES agentes(id) ON DELETE SET NULL"],
    ["pausa_solicitada", "INTEGER NOT NULL DEFAULT 0"],
    ["pausado", "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [nome, tipo] of novasColunasJobs) {
    if (!colunasJobs7.has(nome)) d.exec(`ALTER TABLE jobs ADD COLUMN ${nome} ${tipo}`);
  }
  d.exec("CREATE INDEX IF NOT EXISTS idx_jobs_prioridade ON jobs(status, prioridade, criado_em)");

  // Log real de uso de modelo — toda chamada (Orquestrador OU conversa)
  // grava aqui, nunca só um número agregado. job_id nulo é uma chamada sem
  // job associado (ex: resposta conversacional direta) — ainda assim
  // auditável. Fundação do Model Router (Fase 7): hoje só Anthropic chama
  // isto, mas o formato já é multi-provedor.
  d.exec(`
    CREATE TABLE IF NOT EXISTS chamadas_modelo (
      id              TEXT PRIMARY KEY,
      job_id          TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      provedor        TEXT NOT NULL,
      modelo          TEXT NOT NULL,
      operacao        TEXT NOT NULL,
      tokens_entrada  INTEGER,
      tokens_saida    INTEGER,
      custo_usd       REAL NOT NULL DEFAULT 0,
      sucesso         INTEGER NOT NULL DEFAULT 1,
      motivo_fallback TEXT,
      criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  d.exec("CREATE INDEX IF NOT EXISTS idx_chamadas_modelo_job ON chamadas_modelo(job_id, criado_em DESC)");

  // Fase 8 — Model Router inteligente: latência real por chamada (memória
  // de desempenho, seção 8), motivo de erro em texto (nunca só sucesso=0
  // sem dizer por quê), e modelo_original (quando ESTA linha é uma
  // tentativa de FALLBACK, aponta pro modelo que falhou primeiro — rastro
  // completo original->fallback exigido pela fase).
  const colunasChamadasModelo8 = new Set(
    (d.prepare("PRAGMA table_info(chamadas_modelo)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  const novasColunasChamadasModelo: Array<[string, string]> = [
    ["latencia_ms", "INTEGER"],
    ["erro", "TEXT"],
    ["modelo_original", "TEXT"],
  ];
  for (const [nome, tipo] of novasColunasChamadasModelo) {
    if (!colunasChamadasModelo8.has(nome)) d.exec(`ALTER TABLE chamadas_modelo ADD COLUMN ${nome} ${tipo}`);
  }

  // notificacoes ganha JOB_BLOQUEADO (credencial faltando — hoje bloquearJob
  // não notificava nada, achado real revisando o motor) e
  // OPORTUNIDADE_ENCONTRADA (prospect HOT identificado na síntese de
  // resultado). CHECK novo exige o mesmo padrão recriar->copiar->derrubar->
  // renomear já usado nesta função.
  const sqlNotificacoes7 = (
    d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='notificacoes'").get() as { sql: string } | undefined
  )?.sql;
  if (sqlNotificacoes7 && !sqlNotificacoes7.includes("JOB_BLOQUEADO")) {
    d.exec(`
      CREATE TABLE notificacoes_nova (
        id        TEXT PRIMARY KEY,
        tipo      TEXT NOT NULL CHECK (tipo IN (
                    'JOB_CONCLUIDO','JOB_FALHOU','APROVACAO_NECESSARIA','ERRO_SISTEMA','INFO',
                    'JOB_BLOQUEADO','OPORTUNIDADE_ENCONTRADA')),
        job_id    TEXT REFERENCES jobs(id) ON DELETE CASCADE,
        titulo    TEXT NOT NULL,
        mensagem  TEXT NOT NULL,
        lida      INTEGER NOT NULL DEFAULT 0,
        criado_em TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    d.exec(
      `INSERT INTO notificacoes_nova (id, tipo, job_id, titulo, mensagem, lida, criado_em)
       SELECT id, tipo, job_id, titulo, mensagem, lida, criado_em FROM notificacoes`,
    );
    d.exec("DROP TABLE notificacoes");
    d.exec("ALTER TABLE notificacoes_nova RENAME TO notificacoes");
    d.exec("CREATE INDEX IF NOT EXISTS idx_notificacoes_lida ON notificacoes(lida, criado_em DESC)");
  }

  // Fase 9 — Budget Modes (ECONOMY/BALANCED/QUALITY/MAX_QUALITY). Mesmo
  // padrão de singleton já usado por `nivel` nesta mesma tabela — sem CHECK
  // (ADD COLUMN não permite), validado em código (ver modelo/orcamento.ts).
  const colunasAutonomia9 = new Set(
    (d.prepare("PRAGMA table_info(configuracao_autonomia)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!colunasAutonomia9.has("modo_orcamento")) {
    d.exec("ALTER TABLE configuracao_autonomia ADD COLUMN modo_orcamento TEXT NOT NULL DEFAULT 'BALANCED'");
  }

  // Fase 9 — motivo de roteamento (por que ESTE modelo foi escolhido,
  // sempre gravado, não só quando dá fallback) e nível de escalonamento de
  // validação cruzada aplicado (0-3, ver modelo/validacao-cruzada.ts).
  const colunasChamadasModelo9 = new Set(
    (d.prepare("PRAGMA table_info(chamadas_modelo)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  const novasColunasChamadasModelo9: Array<[string, string]> = [
    ["motivo_roteamento", "TEXT"],
    ["nivel_escalonamento", "INTEGER"],
    // Fase 10 — score de roteamento estruturado (0-1), além do texto livre
    // em motivo_roteamento — fecha "persist... routing score" como coluna
    // consultável, não só embutido em string. tier é derivável do modelo
    // via registro (MODELOS_REGISTRO), não duplicado aqui.
    ["score_roteamento", "REAL"],
  ];
  for (const [nome, tipo] of novasColunasChamadasModelo9) {
    if (!colunasChamadasModelo9.has(nome)) d.exec(`ALTER TABLE chamadas_modelo ADD COLUMN ${nome} ${tipo}`);
  }

  // Fase 11 — Social Media Operating System: notificacoes ganha
  // CONTEUDO_AGUARDANDO_APROVACAO (mesmo padrão recriar->copiar->derrubar->
  // renomear já usado nesta função) e uma coluna conteudo_id opcional, pra
  // rastrear a notificação até o conteúdo sem depender de job_id (conteúdo
  // criado à mão nunca tem job).
  const sqlNotificacoes11 = (
    d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='notificacoes'").get() as { sql: string } | undefined
  )?.sql;
  if (sqlNotificacoes11 && !sqlNotificacoes11.includes("CONTEUDO_AGUARDANDO_APROVACAO")) {
    d.exec(`
      CREATE TABLE notificacoes_nova (
        id           TEXT PRIMARY KEY,
        tipo         TEXT NOT NULL CHECK (tipo IN (
                       'JOB_CONCLUIDO','JOB_FALHOU','APROVACAO_NECESSARIA','ERRO_SISTEMA','INFO',
                       'JOB_BLOQUEADO','OPORTUNIDADE_ENCONTRADA','CONTEUDO_AGUARDANDO_APROVACAO')),
        job_id       TEXT REFERENCES jobs(id) ON DELETE CASCADE,
        conteudo_id  TEXT REFERENCES conteudos_sociais(id) ON DELETE CASCADE,
        titulo       TEXT NOT NULL,
        mensagem     TEXT NOT NULL,
        lida         INTEGER NOT NULL DEFAULT 0,
        criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    d.exec(
      `INSERT INTO notificacoes_nova (id, tipo, job_id, titulo, mensagem, lida, criado_em)
       SELECT id, tipo, job_id, titulo, mensagem, lida, criado_em FROM notificacoes`,
    );
    d.exec("DROP TABLE notificacoes");
    d.exec("ALTER TABLE notificacoes_nova RENAME TO notificacoes");
    d.exec("CREATE INDEX IF NOT EXISTS idx_notificacoes_lida ON notificacoes(lida, criado_em DESC)");
  }

  // Fase 13 — Intelligence Engine: notificacoes ganha INTELIGENCIA_IMPORTANTE
  // + coluna item_inteligencia_id (mesmo padrão recriar->copiar->derrubar->
  // renomear). Nunca dispara por item comum — só quando a pontuação
  // determinística de relevância classifica como CRITICAL/HIGH de verdade.
  const sqlNotificacoes13 = (
    d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='notificacoes'").get() as { sql: string } | undefined
  )?.sql;
  if (sqlNotificacoes13 && !sqlNotificacoes13.includes("INTELIGENCIA_IMPORTANTE")) {
    d.exec(`
      CREATE TABLE notificacoes_nova (
        id                   TEXT PRIMARY KEY,
        tipo                 TEXT NOT NULL CHECK (tipo IN (
                               'JOB_CONCLUIDO','JOB_FALHOU','APROVACAO_NECESSARIA','ERRO_SISTEMA','INFO',
                               'JOB_BLOQUEADO','OPORTUNIDADE_ENCONTRADA','CONTEUDO_AGUARDANDO_APROVACAO',
                               'INTELIGENCIA_IMPORTANTE')),
        job_id               TEXT REFERENCES jobs(id) ON DELETE CASCADE,
        conteudo_id          TEXT REFERENCES conteudos_sociais(id) ON DELETE CASCADE,
        item_inteligencia_id TEXT REFERENCES itens_inteligencia(id) ON DELETE CASCADE,
        titulo               TEXT NOT NULL,
        mensagem             TEXT NOT NULL,
        lida                 INTEGER NOT NULL DEFAULT 0,
        criado_em            TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    d.exec(
      `INSERT INTO notificacoes_nova (id, tipo, job_id, conteudo_id, titulo, mensagem, lida, criado_em)
       SELECT id, tipo, job_id, conteudo_id, titulo, mensagem, lida, criado_em FROM notificacoes`,
    );
    d.exec("DROP TABLE notificacoes");
    d.exec("ALTER TABLE notificacoes_nova RENAME TO notificacoes");
    d.exec("CREATE INDEX IF NOT EXISTS idx_notificacoes_lida ON notificacoes(lida, criado_em DESC)");
  }

  // Fase 14 (parte 2) — armazenamento de token OAuth2 do Google, direto na
  // linha de integracoes que já existia (google_gmail/google_calendar).
  // Sem criptografia em repouso: mesmo nível de proteção que o resto do
  // banco (arquivo local fora do git, sem camada de criptografia própria
  // em nenhuma outra tabela) — documentado, não escondido.
  const colunasIntegracoes14 = new Set(
    (d.prepare("PRAGMA table_info(integracoes)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  const novasColunasIntegracoes14: Array<[string, string]> = [
    ["token_acesso", "TEXT"],
    ["token_atualizacao", "TEXT"],
    ["token_expira_em", "TEXT"],
    ["escopos_concedidos", "TEXT"],
  ];
  for (const [nome, tipo] of novasColunasIntegracoes14) {
    if (!colunasIntegracoes14.has(nome)) d.exec(`ALTER TABLE integracoes ADD COLUMN ${nome} ${tipo}`);
  }

  // Sessão de login do navegador (Fase 15 — produção/single-user). Antes
  // desta fase só existia o Bearer token direto (bom pra script/API, mas o
  // Command Center no navegador nunca mandava esse header — achado real:
  // ligar JARVIS_TOKEN sem isto quebrava a própria UI). Cookie HttpOnly
  // guarda só um id opaco; a senha de login É o JARVIS_TOKEN (nenhum
  // segredo novo pra gerenciar) — comparada em tempo constante, nunca
  // gravada aqui.
  d.exec(`
    CREATE TABLE IF NOT EXISTS sessoes_login (
      id             TEXT PRIMARY KEY,
      criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
      expira_em      TEXT NOT NULL,
      ultimo_uso_em  TEXT NOT NULL DEFAULT (datetime('now')),
      ip_criacao     TEXT
    )
  `);

  // Estado da sincronização do vault Obsidian (Fase 18) — linha única
  // (id=1 travado pelo CHECK) porque é status, não histórico. Sobrevive a
  // restart do container (diferente de estado em memória) — é exatamente
  // o "last successful sync / last failure / retry count" que a Fase 18
  // pediu pra sobreviver a reinício.
  d.exec(`
    CREATE TABLE IF NOT EXISTS obsidian_sync_estado (
      id                      INTEGER PRIMARY KEY CHECK (id = 1),
      ultimo_sucesso_em       TEXT,
      ultimo_commit_em        TEXT,
      ultimo_erro             TEXT,
      ultimo_erro_em          TEXT,
      tentativas_consecutivas INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Interesses padrão (Fase 13) — só semeia se a tabela estiver vazia, nunca
  // sobrescreve o que o Cacique já editou. São ponto de partida configurável,
  // não fato hardcoded — qualquer um pode ser desativado/removido depois.
  const semInteresses = (d.prepare("SELECT COUNT(*) n FROM interesses_inteligencia").get() as { n: number }).n === 0;
  if (semInteresses) {
    const inserirInteresse = d.prepare(`INSERT INTO interesses_inteligencia (id, termo, categoria, peso) VALUES (?,?,?,?)`);
    const padroes: Array<[string, string, number]> = [
      ["inteligência artificial", "ia", 3],
      ["IA generativa", "ia", 3],
      ["marketing digital", "marketing", 3],
      ["tráfego pago", "marketing", 3],
      ["Meta Ads", "marketing", 2],
      ["Google Ads", "marketing", 2],
      ["SaaS", "negocios", 2],
      ["empreendedorismo", "negocios", 2],
      ["automação", "ia", 2],
      ["redes sociais", "marketing", 2],
    ];
    for (const [termo, categoria, peso] of padroes) inserirInteresse.run(crypto.randomUUID(), termo, categoria, peso);
  }

  // aprovacoes ganhou plano_passo_id (Fase 22 — achado real testando o
  // fluxo de aprovação de verdade contra um Plano de DAG, não só o job de
  // Tool única de handlers/executar-ferramenta.ts): sem isto, aprovar um
  // passo de um Plano com VÁRIOS passos usando a MESMA capacidade
  // aprovaria todos eles (a checagem antiga era só job_id+ferramenta,
  // nunca o passo específico) — e pior, aprovar não fazia o passo
  // pausado voltar a rodar nenhuma vez, porque nada além do job_id+
  // ferramenta era checado no retomada (ver plano-orquestrado.ts,
  // executarPasso). NULL pra toda aprovação antiga (nunca vinha de um
  // Plano de DAG antes desta fase — comportamento delas continua
  // idêntico).
  const colunasAprovacoes = new Set(
    (d.prepare("PRAGMA table_info(aprovacoes)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!colunasAprovacoes.has("plano_passo_id")) {
    d.exec("ALTER TABLE aprovacoes ADD COLUMN plano_passo_id TEXT REFERENCES plano_passos(id) ON DELETE CASCADE");
  }

  // Papel de Desenvolvimento — mesmo padrão config-only dos outros papéis
  // acima (Fase 23: o registro de Agente já existia e já era usado pelo
  // Orquestrador desde a Fase 7 — escolherAgentePorCapacidades; as
  // capacidades de código da Fase 20/21/22 só nunca tinham um Agente
  // correspondente, então um Plano de auto-auditoria/escrita sempre
  // ficava com agente_id null, mesmo funcionando).
  const temPapelDesenvolvimento = (d.prepare("SELECT COUNT(*) n FROM agentes WHERE papel = 'desenvolvimento'").get() as { n: number }).n > 0;
  if (!temPapelDesenvolvimento) {
    d.prepare(
      `INSERT INTO agentes (id, nome, papel, objetivo, capacidades, instrucoes, nivel_autonomia_padrao)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(
      crypto.randomUUID(),
      "Agente de Desenvolvimento",
      "desenvolvimento",
      "Inspecionar, verificar e (com aprovação explícita) alterar o próprio código do Jarvis.",
      JSON.stringify([
        "listar_arquivos_jarvis",
        "ler_arquivo_jarvis",
        "escrever_arquivo_jarvis",
        "rodar_testes_jarvis",
        "rodar_typecheck_jarvis",
        "rodar_build_jarvis",
        "inspecionar_git_jarvis",
      ]),
      "Nunca escreve arquivo sem aprovação explícita (ver escrever_arquivo_jarvis, exigeAprovacaoExplicita). Nunca roda contra outro repositório que não seja o próprio Jarvis.",
      1,
    );
  }
}

export function id(): string {
  return crypto.randomUUID();
}

export function agora(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/** Registro inicial de projetos. Locatta e os demais entram somente-leitura. */
function semear(d: DatabaseSync) {
  const ins = d.prepare(
    `INSERT INTO projetos (id, nome, tipo, proposito, permissao) VALUES (?, ?, ?, ?, ?)`,
  );
  const projetos: Array<[string, string, string, string]> = [
    ["JARVIS", "aplicacao", "Casa do sistema. Único projeto com escrita.", "leitura_escrita_deploy"],
    ["LOCATTA", "saas", "SaaS de gestão de locação. Produto e negócio.", "leitura"],
    ["MARKETING", "criativo", "LPs, criativos, conteúdo, campanhas.", "leitura"],
    ["CLIENTES", "referencia", "Contratos e contexto das contas da agência.", "leitura"],
    ["CRIATIVOS", "criativo", "Pipeline de produção de criativo.", "leitura"],
    ["DESENVOLVIMENTO", "referencia", "Trabalho técnico fora do Jarvis.", "leitura"],
    ["PESSOAL", "pessoal", "Contexto pessoal, rotina, aprendizado.", "leitura_escrita"],
  ];
  for (const [nome, tipo, proposito, permissao] of projetos) {
    ins.run(crypto.randomUUID(), nome, tipo, proposito, permissao);
  }
}

/** Registra na auditoria. Nunca falha a operação principal por causa do log. */
export function auditar(entrada: {
  acao: string;
  projeto_id?: string | null;
  tool?: string | null;
  skill?: string | null;
  permissao?: number | null;
  motivo?: string | null;
  resultado?: string | null;
  impacto?: string | null;
  erro?: string | null;
}) {
  try {
    db()
      .prepare(
        `INSERT INTO auditoria (id, projeto_id, tool, skill, acao, permissao, motivo, resultado, impacto, erro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id(),
        entrada.projeto_id ?? null,
        entrada.tool ?? null,
        entrada.skill ?? null,
        entrada.acao,
        entrada.permissao ?? null,
        entrada.motivo ?? null,
        entrada.resultado ?? null,
        entrada.impacto ?? null,
        entrada.erro ?? null,
      );
  } catch {
    // auditoria nunca derruba a operação
  }
}
