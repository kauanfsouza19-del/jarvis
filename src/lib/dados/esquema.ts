import "server-only";

/**
 * Esquema do Jarvis.
 *
 * Escrito para SQLite (node:sqlite — nativo, zero dependência) porque a fase de
 * persistência não pode esperar a criação de um projeto Supabase, que exige
 * login do Cacique. O espelho Postgres/Supabase vive em `supabase/001_esquema.sql`
 * e é a migração de destino.
 *
 * Toda a leitura e escrita passa por `src/lib/dados/` — trocar o motor é
 * localizado, não espalhado pela aplicação.
 */

export const VERSAO_ESQUEMA = 1;

export const DDL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================ PROJETOS

CREATE TABLE IF NOT EXISTS projetos (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL UNIQUE,
  tipo          TEXT NOT NULL,              -- aplicacao | saas | criativo | referencia | pessoal
  proposito     TEXT NOT NULL DEFAULT '',
  resumo        TEXT NOT NULL DEFAULT '',   -- resumo compacto injetado no prompt (~400 tokens)
  permissao     TEXT NOT NULL DEFAULT 'leitura'
                CHECK (permissao IN ('leitura','leitura_escrita','leitura_escrita_deploy')),
  estado        TEXT NOT NULL DEFAULT 'ativo',
  saude         TEXT NOT NULL DEFAULT 'verde' CHECK (saude IN ('verde','amarelo','vermelho')),
  indexado_em   TEXT,
  arquivos      INTEGER NOT NULL DEFAULT 0,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  -- NOTA: caminho de máquina NÃO mora aqui. Fica só na config do agente local.
);

-- ============================================================ CONVERSAS

CREATE TABLE IF NOT EXISTS conversas (
  id            TEXT PRIMARY KEY,
  titulo        TEXT NOT NULL DEFAULT 'Nova conversa',
  projeto_id    TEXT REFERENCES projetos(id) ON DELETE SET NULL,
  modo          TEXT NOT NULL DEFAULT 'direto'
                CHECK (modo IN ('consultivo','direto','socio_incomodo')),
  estado        TEXT NOT NULL DEFAULT 'ativa'
                CHECK (estado IN ('ativa','arquivada')),
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conversas_recentes ON conversas(estado, atualizado_em DESC);
CREATE INDEX IF NOT EXISTS idx_conversas_projeto  ON conversas(projeto_id);

CREATE TABLE IF NOT EXISTS mensagens (
  id             TEXT PRIMARY KEY,
  conversa_id    TEXT NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  papel          TEXT NOT NULL CHECK (papel IN ('user','assistant','system')),
  conteudo       TEXT NOT NULL,
  projeto_id     TEXT REFERENCES projetos(id) ON DELETE SET NULL,
  modo           TEXT,
  modelo         TEXT,
  esforco        TEXT,
  tokens_entrada INTEGER,
  tokens_saida   INTEGER,
  cache_lido     INTEGER,
  tools_usadas   TEXT,                      -- JSON: nomes das tools desta volta
  estado_exec    TEXT,                      -- ok | erro | aguardando_aprovacao
  fontes         TEXT,                      -- JSON: ids de trechos_conhecimento citados
  memorias_ref   TEXT,                      -- JSON: ids de memorias recuperadas
  criado_em      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mensagens_conversa ON mensagens(conversa_id, criado_em);

-- ============================================================ MEMÓRIA PESSOAL
-- O que o Cacique prefere, decidiu, quer. Só muda quando ele muda de ideia.

CREATE TABLE IF NOT EXISTS memorias (
  id                TEXT PRIMARY KEY,
  tipo              TEXT NOT NULL CHECK (tipo IN (
                      'FATO','PREFERENCIA','META','PROJETO','DECISAO','TAREFA',
                      'ROTINA','OPORTUNIDADE','CONTEXTO_TEMP','SKILL','LICAO','EXPERIMENTO')),
  camada            TEXT NOT NULL DEFAULT 'recuperavel'
                    CHECK (camada IN ('nucleo','recuperavel','estrategica','temporaria')),
  titulo            TEXT NOT NULL,
  corpo             TEXT NOT NULL,
  projeto_id        TEXT REFERENCES projetos(id) ON DELETE SET NULL,
  origem            TEXT NOT NULL DEFAULT 'conversa',
  confianca         REAL NOT NULL DEFAULT 0.7 CHECK (confianca >= 0 AND confianca <= 1),
  importancia       INTEGER NOT NULL DEFAULT 3 CHECK (importancia BETWEEN 1 AND 5),
  estado            TEXT NOT NULL DEFAULT 'ATIVA'
                    CHECK (estado IN ('ATIVA','DESATUALIZADA','REVOGADA','ARQUIVADA')),
  substituida_por   TEXT REFERENCES memorias(id) ON DELETE SET NULL,
  expira_em         TEXT,
  criado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  verificado_em     TEXT
);
CREATE INDEX IF NOT EXISTS idx_memorias_ativas  ON memorias(estado, importancia DESC, atualizado_em DESC);
CREATE INDEX IF NOT EXISTS idx_memorias_projeto ON memorias(projeto_id, estado);
CREATE INDEX IF NOT EXISTS idx_memorias_tipo    ON memorias(tipo, estado);

CREATE VIRTUAL TABLE IF NOT EXISTS memorias_fts USING fts5(
  titulo, corpo, content='memorias', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS memorias_fts_ins AFTER INSERT ON memorias BEGIN
  INSERT INTO memorias_fts(rowid, titulo, corpo) VALUES (new.rowid, new.titulo, new.corpo);
END;
CREATE TRIGGER IF NOT EXISTS memorias_fts_del AFTER DELETE ON memorias BEGIN
  INSERT INTO memorias_fts(memorias_fts, rowid, titulo, corpo)
  VALUES ('delete', old.rowid, old.titulo, old.corpo);
END;
CREATE TRIGGER IF NOT EXISTS memorias_fts_upd AFTER UPDATE ON memorias BEGIN
  INSERT INTO memorias_fts(memorias_fts, rowid, titulo, corpo)
  VALUES ('delete', old.rowid, old.titulo, old.corpo);
  INSERT INTO memorias_fts(rowid, titulo, corpo) VALUES (new.rowid, new.titulo, new.corpo);
END;

CREATE TABLE IF NOT EXISTS memoria_relacoes (
  id         TEXT PRIMARY KEY,
  de_id      TEXT NOT NULL REFERENCES memorias(id) ON DELETE CASCADE,
  para_id    TEXT NOT NULL REFERENCES memorias(id) ON DELETE CASCADE,
  relacao    TEXT NOT NULL,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (de_id, para_id, relacao)
);

-- ============================================================ CONHECIMENTO DE PROJETO
-- Fato de repositório: "o Locatta usa Evolution API". Expira quando o código muda.
-- Deliberadamente separado da tabela memorias — misturar os dois é o pior erro
-- de um segundo cérebro: tratar escolha do usuário como fato técnico, ou
-- detalhe de código obsoleto como preferência.

CREATE TABLE IF NOT EXISTS projeto_conhecimento (
  id            TEXT PRIMARY KEY,
  projeto_id    TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  caminho       TEXT,                       -- caminho RELATIVO dentro do projeto
  titulo        TEXT NOT NULL,
  corpo         TEXT NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'fato',
  confianca     REAL NOT NULL DEFAULT 0.8,
  indexado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  obsoleto      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pc_projeto ON projeto_conhecimento(projeto_id, obsoleto);

CREATE VIRTUAL TABLE IF NOT EXISTS projeto_conhecimento_fts USING fts5(
  titulo, corpo, content='projeto_conhecimento', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS pc_fts_ins AFTER INSERT ON projeto_conhecimento BEGIN
  INSERT INTO projeto_conhecimento_fts(rowid, titulo, corpo) VALUES (new.rowid, new.titulo, new.corpo);
END;
CREATE TRIGGER IF NOT EXISTS pc_fts_del AFTER DELETE ON projeto_conhecimento BEGIN
  INSERT INTO projeto_conhecimento_fts(projeto_conhecimento_fts, rowid, titulo, corpo)
  VALUES ('delete', old.rowid, old.titulo, old.corpo);
END;

-- ============================================================ METAS · TAREFAS · DECISÕES

CREATE TABLE IF NOT EXISTS metas (
  id           TEXT PRIMARY KEY,
  nivel        TEXT NOT NULL CHECK (nivel IN ('vida','negocio','projeto','semana')),
  pai_id       TEXT REFERENCES metas(id) ON DELETE SET NULL,
  titulo       TEXT NOT NULL,
  alvo         TEXT,
  estado_atual TEXT,
  prazo        TEXT,
  progresso    REAL NOT NULL DEFAULT 0,
  projeto_id   TEXT REFERENCES projetos(id) ON DELETE SET NULL,
  estado       TEXT NOT NULL DEFAULT 'ativa',
  criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tarefas (
  id          TEXT PRIMARY KEY,
  titulo      TEXT NOT NULL,
  detalhe     TEXT NOT NULL DEFAULT '',
  projeto_id  TEXT REFERENCES projetos(id) ON DELETE SET NULL,
  meta_id     TEXT REFERENCES metas(id) ON DELETE SET NULL,
  impacto     INTEGER NOT NULL DEFAULT 3 CHECK (impacto BETWEEN 1 AND 5),
  esforco_min INTEGER,
  urgencia    INTEGER NOT NULL DEFAULT 3 CHECK (urgencia BETWEEN 1 AND 5),
  prazo       TEXT,
  origem      TEXT NOT NULL DEFAULT 'manual',
  estado      TEXT NOT NULL DEFAULT 'aberta'
              CHECK (estado IN ('aberta','fazendo','concluida','descartada')),
  criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  concluido_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_tarefas_abertas ON tarefas(estado, urgencia DESC, impacto DESC);

CREATE TABLE IF NOT EXISTS decisoes (
  id             TEXT PRIMARY KEY,
  titulo         TEXT NOT NULL,
  contexto       TEXT NOT NULL DEFAULT '',
  alternativas   TEXT NOT NULL DEFAULT '',
  escolha        TEXT NOT NULL,
  motivo         TEXT NOT NULL DEFAULT '',
  resultado_esperado TEXT NOT NULL DEFAULT '',
  projeto_id     TEXT REFERENCES projetos(id) ON DELETE SET NULL,
  revisar_em     TEXT,
  resultado_real TEXT,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experimentos (
  id         TEXT PRIMARY KEY,
  titulo     TEXT NOT NULL,
  hipotese   TEXT NOT NULL DEFAULT '',
  metodo     TEXT NOT NULL DEFAULT '',
  resultado  TEXT,
  conclusao  TEXT,
  projeto_id TEXT REFERENCES projetos(id) ON DELETE SET NULL,
  estado     TEXT NOT NULL DEFAULT 'rodando',
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS licoes (
  id            TEXT PRIMARY KEY,
  titulo        TEXT NOT NULL,
  corpo         TEXT NOT NULL,
  origem_tipo   TEXT,                       -- decisao | experimento | job | conversa
  origem_id     TEXT,
  projeto_id    TEXT REFERENCES projetos(id) ON DELETE SET NULL,
  confianca     REAL NOT NULL DEFAULT 0.6,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================ BASE DE CONHECIMENTO
-- Governança: nada é importado sem fonte, nível de evidência e confiança.
-- MENÇÃO ISOLADA nunca vira CONSENSO FORTE em silêncio.

CREATE TABLE IF NOT EXISTS fontes_conhecimento (
  id          TEXT PRIMARY KEY,
  titulo      TEXT NOT NULL,
  tipo        TEXT NOT NULL,                -- pdf | docx | txt | markdown | transcricao | nota | url | pesquisa
  url         TEXT,
  autor       TEXT,
  data_fonte  TEXT,
  categoria   TEXT,
  tags        TEXT,                         -- JSON
  projeto_id  TEXT REFERENCES projetos(id) ON DELETE SET NULL,
  estado      TEXT NOT NULL DEFAULT 'AGUARDANDO_CONTEUDO'
              CHECK (estado IN ('AGUARDANDO_CONTEUDO','INGERIDA','FALHOU','ARQUIVADA')),
  importado_em TEXT NOT NULL DEFAULT (datetime('now')),
  verificado_em TEXT,
  observacao  TEXT
);

CREATE TABLE IF NOT EXISTS documentos_conhecimento (
  id         TEXT PRIMARY KEY,
  fonte_id   TEXT NOT NULL REFERENCES fontes_conhecimento(id) ON DELETE CASCADE,
  modulo     TEXT,                          -- google_ads | meta_ads | cro | hooks | ofertas | ...
  titulo     TEXT NOT NULL,
  resumo     TEXT NOT NULL DEFAULT '',
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_doc_fonte ON documentos_conhecimento(fonte_id, modulo);

CREATE TABLE IF NOT EXISTS trechos_conhecimento (
  id            TEXT PRIMARY KEY,
  documento_id  TEXT NOT NULL REFERENCES documentos_conhecimento(id) ON DELETE CASCADE,
  fonte_id      TEXT NOT NULL REFERENCES fontes_conhecimento(id) ON DELETE CASCADE,
  ordem         INTEGER NOT NULL DEFAULT 0,
  afirmacao     TEXT NOT NULL,
  corpo         TEXT NOT NULL,
  modulo        TEXT,
  evidencia     TEXT NOT NULL DEFAULT 'MENCAO_ISOLADA'
                CHECK (evidencia IN ('CONSENSO_FORTE','CONSENSO_PARCIAL','MENCAO_ISOLADA')),
  natureza      TEXT NOT NULL DEFAULT 'HEURISTICA'
                CHECK (natureza IN ('FATO','HEURISTICA','HIPOTESE','REGRA_OPERACIONAL','OPINIAO')),
  confianca     REAL NOT NULL DEFAULT 0.5,
  referencias   TEXT,                       -- JSON
  embedding     TEXT,                       -- reservado: preenchido quando escolhermos o provedor
  importado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  verificado_em TEXT,
  obsoleto      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_trechos_modulo ON trechos_conhecimento(modulo, obsoleto);
CREATE INDEX IF NOT EXISTS idx_trechos_fonte  ON trechos_conhecimento(fonte_id);

CREATE VIRTUAL TABLE IF NOT EXISTS trechos_fts USING fts5(
  afirmacao, corpo, content='trechos_conhecimento', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS trechos_fts_ins AFTER INSERT ON trechos_conhecimento BEGIN
  INSERT INTO trechos_fts(rowid, afirmacao, corpo) VALUES (new.rowid, new.afirmacao, new.corpo);
END;
CREATE TRIGGER IF NOT EXISTS trechos_fts_del AFTER DELETE ON trechos_conhecimento BEGIN
  INSERT INTO trechos_fts(trechos_fts, rowid, afirmacao, corpo)
  VALUES ('delete', old.rowid, old.afirmacao, old.corpo);
END;

CREATE TABLE IF NOT EXISTS conhecimento_relacoes (
  id        TEXT PRIMARY KEY,
  trecho_id TEXT NOT NULL REFERENCES trechos_conhecimento(id) ON DELETE CASCADE,
  alvo_tipo TEXT NOT NULL CHECK (alvo_tipo IN ('projeto','skill','decisao','experimento','licao','oportunidade')),
  alvo_id   TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (trecho_id, alvo_tipo, alvo_id)
);

-- ============================================================ SKILLS

CREATE TABLE IF NOT EXISTS skills (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL UNIQUE,
  descricao     TEXT NOT NULL DEFAULT '',
  gatilho       TEXT NOT NULL DEFAULT '',
  classe        TEXT NOT NULL DEFAULT 'declarativa'
                CHECK (classe IN ('declarativa','imperativa')),
  permissao     INTEGER NOT NULL DEFAULT 1 CHECK (permissao BETWEEN 0 AND 4),
  tools         TEXT,                       -- JSON
  schema_entrada TEXT,
  schema_saida  TEXT,
  implementacao TEXT,
  versao        INTEGER NOT NULL DEFAULT 1,
  estado        TEXT NOT NULL DEFAULT 'EM_TESTE'
                CHECK (estado IN ('ATIVA','EM_TESTE','SOMBRA','DESATIVADA','FALHOU','DEPRECIADA')),
  custo_estimado REAL,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================ INTEGRAÇÕES
-- Estado real de cada serviço externo. Credencial NUNCA mora aqui — só
-- variável de ambiente. Esta tabela guarda só o que é seguro persistir:
-- provedor, identidade pública (e-mail conectado, não o token), status,
-- última sincronização e último erro.

CREATE TABLE IF NOT EXISTS integracoes (
  id             TEXT PRIMARY KEY,
  provedor       TEXT NOT NULL,          -- google_gmail | google_calendar | google_places | playwright | ...
  identidade     TEXT,                   -- e-mail ou identificador público da conta conectada
  estado         TEXT NOT NULL DEFAULT 'NAO_CONFIGURADO'
                 CHECK (estado IN ('CONECTADO','AUTH_NECESSARIA','DEGRADADO','LIMITE_TAXA','ERRO','NAO_CONFIGURADO')),
  permissoes     TEXT,                   -- JSON: escopos concedidos
  ultima_sincronizacao TEXT,
  ultimo_erro    TEXT,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================ E-MAIL (multi-conta)

CREATE TABLE IF NOT EXISTS contas_email (
  id           TEXT PRIMARY KEY,
  integracao_id TEXT REFERENCES integracoes(id) ON DELETE CASCADE,
  provedor     TEXT NOT NULL CHECK (provedor IN ('gmail','outlook','outro')),
  endereco     TEXT NOT NULL,
  estado       TEXT NOT NULL DEFAULT 'AUTH_NECESSARIA'
               CHECK (estado IN ('CONECTADO','AUTH_NECESSARIA','DEGRADADO','ERRO')),
  ultima_sincronizacao TEXT,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emails (
  id           TEXT PRIMARY KEY,
  conta_id     TEXT NOT NULL REFERENCES contas_email(id) ON DELETE CASCADE,
  id_provedor  TEXT NOT NULL,            -- id da mensagem no Gmail/Outlook — nunca duplicar por conta
  remetente    TEXT NOT NULL,
  assunto      TEXT NOT NULL DEFAULT '',
  resumo       TEXT,                     -- WHO/WHAT/WHY/ACTION/DEADLINE — gerado, não o corpo cru
  categoria    TEXT NOT NULL DEFAULT 'INFORMACAO'
               CHECK (categoria IN (
                 'CRITICO','SEGURANCA','PLATAFORMA','CLIENTE','FINANCEIRO','ACAO_NECESSARIA',
                 'REUNIAO','IMPORTANTE','INFORMACAO','MARKETING','NOTIFICACAO','SPAM','RUIDO')),
  prioridade   INTEGER NOT NULL DEFAULT 3 CHECK (prioridade BETWEEN 1 AND 5),
  projeto_id   TEXT REFERENCES projetos(id) ON DELETE SET NULL,
  lido         INTEGER NOT NULL DEFAULT 0,
  importante   INTEGER NOT NULL DEFAULT 0,
  arquivado    INTEGER NOT NULL DEFAULT 0,
  recebido_em  TEXT NOT NULL,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(conta_id, id_provedor)
);
CREATE INDEX IF NOT EXISTS idx_emails_prioridade ON emails(arquivado, prioridade DESC, recebido_em DESC);

-- Regra de remetente aprendida por correção repetida do Cacique — nunca uma
-- correção isolada vira regra permanente sozinha (ver 11. EMAIL LEARNING).
CREATE TABLE IF NOT EXISTS regras_remetente (
  id          TEXT PRIMARY KEY,
  remetente   TEXT NOT NULL UNIQUE,
  categoria   TEXT,
  prioridade  INTEGER,
  confirmacoes INTEGER NOT NULL DEFAULT 1,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================ AGENDA (multi-calendário)

CREATE TABLE IF NOT EXISTS eventos_agenda (
  id           TEXT PRIMARY KEY,
  integracao_id TEXT REFERENCES integracoes(id) ON DELETE CASCADE,
  id_provedor  TEXT NOT NULL,
  calendario   TEXT NOT NULL DEFAULT 'principal',
  titulo       TEXT NOT NULL,
  inicio       TEXT NOT NULL,
  fim          TEXT NOT NULL,
  local        TEXT,
  participantes TEXT,                    -- JSON
  projeto_id   TEXT REFERENCES projetos(id) ON DELETE SET NULL,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(integracao_id, id_provedor)
);
CREATE INDEX IF NOT EXISTS idx_agenda_inicio ON eventos_agenda(inicio);

-- ============================================================ PROSPECÇÃO
-- Motor de dinheiro primário. Todo campo observado tem origem; nada aqui é
-- fabricado — CNPJ, telefone, site só entram com fonte pública real.

CREATE TABLE IF NOT EXISTS prospects (
  id              TEXT PRIMARY KEY,
  negocio         TEXT NOT NULL,
  vertical        TEXT NOT NULL,         -- delivery | ecommerce | locatta_corretor | ...
  cidade          TEXT,
  place_id        TEXT,
  website         TEXT,
  telefone_publico TEXT,
  whatsapp_publico TEXT,
  email_publico   TEXT,
  instagram       TEXT,
  facebook        TEXT,
  cnpj            TEXT,
  fonte           TEXT NOT NULL,         -- de onde veio: google_places | site_proprio | manual | ...
  descoberto_em   TEXT NOT NULL DEFAULT (datetime('now')),
  verificado_em   TEXT,
  estado          TEXT NOT NULL DEFAULT 'NOVO'
                  CHECK (estado IN ('NOVO','QUALIFICADO','DESCARTADO','ABORDADO','EM_NEGOCIACAO','CLIENTE','PERDIDO')),
  score           INTEGER,
  motivo_score    TEXT,                  -- por que esse score — auditável, não caixa-preta
  dor_observada   TEXT,                  -- JSON: lista de {sinal, observado_ou_inferido, evidencia}
  oportunidades   TEXT,                  -- JSON: categorias de oportunidade
  contatabilidade INTEGER,               -- 1-5, um dos vários fatores do score — nunca o único
  classificacao_oportunidade TEXT CHECK (classificacao_oportunidade IN ('HOT','HIGH','MEDIUM','LOW','UNKNOWN')),
  confianca_pontuacao TEXT CHECK (confianca_pontuacao IN ('alta','media','baixa')),
  abordagem_sugerida TEXT,
  notas           TEXT,
  duplicata_de    TEXT REFERENCES prospects(id) ON DELETE SET NULL,
  criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prospects_score ON prospects(estado, score DESC);
CREATE INDEX IF NOT EXISTS idx_prospects_vertical ON prospects(vertical, cidade);

-- Diagnóstico de site — o que a inspeção real encontrou, com timestamp.
-- Nunca reescreve por cima: histórico de diagnóstico é o que prova que uma
-- afirmação era verdadeira NAQUELE momento, não uma verdade permanente.
CREATE TABLE IF NOT EXISTS diagnosticos_site (
  id           TEXT PRIMARY KEY,
  prospect_id  TEXT REFERENCES prospects(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  http_status  INTEGER,
  tempo_carregamento_ms INTEGER,
  tem_meta_pixel INTEGER,
  tem_gtm      INTEGER,
  tem_ga4      INTEGER,
  tem_whatsapp_link INTEGER,
  tem_instagram_link INTEGER,
  viewport_mobile INTEGER,
  titulo_pagina TEXT,
  descricao_meta TEXT,
  sinais_brutos TEXT,                    -- JSON: tudo que foi observado, cru
  erro         TEXT,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_diagnosticos_prospect ON diagnosticos_site(prospect_id, criado_em DESC);

-- Evidência de enriquecimento — cada campo público coletado (Instagram,
-- WhatsApp, e-mail, telefone, Facebook...) carrega DE ONDE veio e o quanto
-- se confia nele. Nunca grava um valor sem fonte; nunca reescreve por cima
-- (mesma lógica de diagnosticos_site) — se o mesmo campo for coletado de
-- novo depois, entra uma linha nova, histórico completo.
-- status distingue "verifiquei e não achei" de "nunca verifiquei" de "achei
-- mas a página não carregou direito pra ter certeza" — nunca vira
-- "não existe" (nunca escrito) por acidente. valor fica vazio quando o
-- status não é 'encontrado'.
CREATE TABLE IF NOT EXISTS prospect_evidencias (
  id           TEXT PRIMARY KEY,
  prospect_id  TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  campo        TEXT NOT NULL,          -- 'instagram'|'whatsapp'|'email'|'telefone'|'facebook'|'website'|...
  valor        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'encontrado'
               CHECK (status IN ('encontrado','nao_encontrado','nao_verificado','inconclusivo')),
  fonte        TEXT NOT NULL,          -- ex: 'site_publico:https://exemplo.com'
  confianca    TEXT NOT NULL CHECK (confianca IN ('alta','media','baixa')),
  coletado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prospect_evidencias_prospect ON prospect_evidencias(prospect_id, campo, coletado_em DESC);

-- ============================================================ WHATSAPP
-- Canal, não cérebro separado. Mensagem que chega aqui entra pelo MESMO
-- /api/conversar que o web usa — esta tabela só guarda sessão do provedor e
-- o vínculo mensagem-whatsapp ↔ conversa/aprovação, nunca lógica própria.

CREATE TABLE IF NOT EXISTS whatsapp_sessoes (
  id            TEXT PRIMARY KEY,
  provedor      TEXT NOT NULL DEFAULT 'evolution_api',
  numero        TEXT,                    -- número emparelhado, quando conectado
  estado        TEXT NOT NULL DEFAULT 'DESCONECTADO'
                CHECK (estado IN (
                  'DESCONECTADO','CONECTANDO','AGUARDANDO_QR','CONECTADO',
                  'RECONECTANDO','ERRO','EXPIRADO','INDISPONIVEL')),
  ultimo_heartbeat TEXT,
  ultimo_erro   TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Só o número do dono pode acionar o sistema — qualquer outro é dado, nunca
-- comando. Ver seguranca/whatsapp.ts.
CREATE TABLE IF NOT EXISTS whatsapp_numero_dono (
  id        TEXT PRIMARY KEY,
  numero_e164 TEXT NOT NULL UNIQUE,
  ativo     INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS whatsapp_mensagens (
  id             TEXT PRIMARY KEY,
  id_provedor    TEXT NOT NULL UNIQUE,   -- id da mensagem no provedor — nunca processa duas vezes
  direcao        TEXT NOT NULL CHECK (direcao IN ('entrada','saida')),
  numero_remoto  TEXT NOT NULL,
  autorizado     INTEGER NOT NULL DEFAULT 0, -- veio do número dono?
  tipo           TEXT NOT NULL DEFAULT 'texto'
                 CHECK (tipo IN ('texto','audio','imagem','documento','localizacao','link')),
  conteudo_texto TEXT,
  conversa_id    TEXT REFERENCES conversas(id) ON DELETE SET NULL,
  aprovacao_id   TEXT,
  estado_processamento TEXT NOT NULL DEFAULT 'recebida'
                 CHECK (estado_processamento IN ('recebida','processando','respondida','rejeitada','erro')),
  erro           TEXT,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_msg_conversa ON whatsapp_mensagens(conversa_id, criado_em);

CREATE TABLE IF NOT EXISTS whatsapp_aprovacoes (
  id            TEXT PRIMARY KEY,
  numero_remoto TEXT NOT NULL,
  tarefa        TEXT NOT NULL,
  acao_proposta TEXT NOT NULL,
  motivo        TEXT,
  risco         TEXT,
  custo         TEXT,
  expira_em     TEXT,
  estado        TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (estado IN ('PENDENTE','APROVADA','REJEITADA','EXPIRADA')),
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  respondido_em TEXT
);

-- ============================================================ CUSTO
-- Nunca recalcula o que já foi medido — a tabela mensagens já grava tokens
-- reais por turno. Isto agrega e dá teto configurável.

CREATE TABLE IF NOT EXISTS orcamentos (
  id            TEXT PRIMARY KEY,
  escopo        TEXT NOT NULL,           -- 'global' | 'projeto:<id>' | 'skill:<nome>'
  periodo       TEXT NOT NULL CHECK (periodo IN ('diario','semanal','mensal')),
  limite_usd    REAL NOT NULL,
  aviso_em      REAL NOT NULL DEFAULT 0.7,
  critico_em    REAL NOT NULL DEFAULT 0.9,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cache de resultado determinístico/pesquisa — chave, fonte, validade. Nunca
-- reprocessa o que já está aqui e ainda válido.
CREATE TABLE IF NOT EXISTS cache_resultados (
  chave        TEXT PRIMARY KEY,
  fonte        TEXT NOT NULL,
  valor        TEXT NOT NULL,            -- JSON
  confianca    REAL,
  versao       INTEGER NOT NULL DEFAULT 1,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now')),
  expira_em    TEXT
);
CREATE INDEX IF NOT EXISTS idx_cache_expira ON cache_resultados(expira_em);

-- ============================================================ JOBS
-- Mensagem que vira trabalho persistente. Roda solto no processo do
-- servidor (não amarrada a conexão HTTP) para sobreviver a fechar a aba.
-- Não sobrevive a reiniciar o servidor por mágica — mas o estado no banco
-- NUNCA mente sobre isso: a rotina de recuperação na inicialização
-- encontra job preso em EXECUTANDO de um processo morto e ou retoma (se o
-- tipo é retomável e há passo concluído aproveitável) ou marca FALHOU com o
-- motivo — nunca deixa "executando" para sempre, nunca finge sucesso.

CREATE TABLE IF NOT EXISTS jobs (
  id             TEXT PRIMARY KEY,
  conversa_id    TEXT REFERENCES conversas(id) ON DELETE SET NULL,
  tipo           TEXT NOT NULL,          -- 'prospeccao_diagnostico' | ... — chave do registro de handlers
  parametros     TEXT NOT NULL,          -- JSON: o que foi pedido
  chave_dedup    TEXT,                   -- hash(tipo+parametros+conversa) — evita job duplicado em FILA/EXECUTANDO
  status         TEXT NOT NULL DEFAULT 'FILA'
                 CHECK (status IN (
                   'FILA','EXECUTANDO','AGUARDANDO_APROVACAO','CONCLUIDO',
                   'FALHOU','BLOQUEADO','CANCELADO')),
  progresso_atual INTEGER NOT NULL DEFAULT 0,
  progresso_total INTEGER NOT NULL DEFAULT 0,
  etapa          TEXT,                  -- rótulo curto da etapa atual — "Diagnosticando site 4/10"
  resultado_id   TEXT,
  erro           TEXT,
  tentativas     INTEGER NOT NULL DEFAULT 0,
  retomavel      INTEGER NOT NULL DEFAULT 0, -- 1 = passo concluído pode ser aproveitado numa retomada
  cancelamento_solicitado INTEGER NOT NULL DEFAULT 0, -- checado entre passos — cancelamento cooperativo
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  iniciado_em    TEXT,
  concluido_em   TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_conversa ON jobs(conversa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_dedup ON jobs(chave_dedup, status);

-- Passo persistido — não só o rótulo textual da etapa atual, mas o
-- histórico de cada sub-unidade de trabalho, com estado próprio. É o que
-- permite uma retomada pular o que já foi feito em vez de tudo de novo.
CREATE TABLE IF NOT EXISTS job_passos (
  id         TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  ordem      INTEGER NOT NULL,
  nome       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'PENDENTE'
             CHECK (status IN ('PENDENTE','EXECUTANDO','CONCLUIDO','FALHOU','PULADO')),
  detalhe    TEXT,
  erro       TEXT,
  iniciado_em  TEXT,
  concluido_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_passos_job ON job_passos(job_id, ordem);

-- Linha do tempo do job — append-only, é o que a UI lê para mostrar o que
-- de fato aconteceu, na ordem em que aconteceu.
CREATE TABLE IF NOT EXISTS job_eventos (
  id       TEXT PRIMARY KEY,
  job_id   TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tipo     TEXT NOT NULL,   -- 'criado'|'iniciado'|'passo'|'progresso'|'aguardando_aprovacao'|'concluido'|'falhou'|'cancelado'|'retomado'
  mensagem TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_job_eventos_job ON job_eventos(job_id, criado_em);

-- Aprovação de ação de alto impacto — canal-agnóstica (Command Center hoje,
-- WhatsApp/e-mail amanhã sem mudar esta tabela). Job em AGUARDANDO_APROVACAO
-- referencia uma linha aqui.
CREATE TABLE IF NOT EXISTS aprovacoes (
  id            TEXT PRIMARY KEY,
  job_id        TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  ferramenta    TEXT,             -- nome da Tool que exige aprovação, quando aplicável
  nivel_permissao TEXT,           -- READ|WRITE|SEND|DELETE|FINANCIAL|EXTERNAL_COMMUNICATION|ACCOUNT_ACCESS
  titulo        TEXT NOT NULL,
  descricao     TEXT NOT NULL,
  risco         TEXT,
  estado        TEXT NOT NULL DEFAULT 'PENDENTE'
                CHECK (estado IN ('PENDENTE','APROVADA','REJEITADA','EXPIRADA')),
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  respondido_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_aprovacoes_estado ON aprovacoes(estado, criado_em DESC);

-- Notificação — o que precisa da atenção do Cacique. Canal é metadado, não
-- efeito colateral automático: som/voz/browser são decisão da UI, esta
-- tabela só registra o que aconteceu e se já foi lida.
CREATE TABLE IF NOT EXISTS notificacoes (
  id        TEXT PRIMARY KEY,
  tipo      TEXT NOT NULL CHECK (tipo IN (
              'JOB_CONCLUIDO','JOB_FALHOU','APROVACAO_NECESSARIA','ERRO_SISTEMA','INFO')),
  job_id    TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  titulo    TEXT NOT NULL,
  mensagem  TEXT NOT NULL,
  lida      INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notificacoes_lida ON notificacoes(lida, criado_em DESC);

-- parent_result_id/operacao/metadados_transformacao são a linhagem de
-- resultado derivado: "30 pizzarias" -> "+ Instagram" -> "+ site/telefone/
-- email" -> "10 de maior prioridade" continua rastreável até a descoberta
-- original. Nunca reescreve o resultado pai — cada transformação grava uma
-- linha NOVA aqui, apontando pra de onde veio.
CREATE TABLE IF NOT EXISTS resultados (
  id           TEXT PRIMARY KEY,
  execucao_id  TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL,           -- 'lista_prospects' | ...
  resumo       TEXT NOT NULL,           -- JSON: totais reais, nunca estimados
  parent_result_id TEXT REFERENCES resultados(id) ON DELETE SET NULL,
  operacao     TEXT,                    -- 'descoberta'|'filtro'|'selecao'|'enriquecimento'|'analise_marketing'|'pontuacao'|'abordagem'
  metadados_transformacao TEXT,         -- JSON: o que essa transformação fez (filtro aplicado, campos pedidos, etc.)
  criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resultados_parent ON resultados(parent_result_id);

-- Snapshot de QUAIS prospects pertencem a este resultado, na ordem — segue
-- existindo mesmo que o prospect mude de score depois. Follow-up
-- conversacional ("mostra só os com whatsapp") filtra ESTE conjunto, nunca
-- dispara uma busca nova.
CREATE TABLE IF NOT EXISTS resultado_prospects (
  resultado_id TEXT NOT NULL REFERENCES resultados(id) ON DELETE CASCADE,
  prospect_id  TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  ordem        INTEGER NOT NULL,
  PRIMARY KEY (resultado_id, prospect_id)
);

CREATE TABLE IF NOT EXISTS arquivos_gerados (
  id           TEXT PRIMARY KEY,
  resultado_id TEXT NOT NULL REFERENCES resultados(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('csv','xlsx')),
  nome         TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  tamanho_bytes INTEGER NOT NULL,
  caminho      TEXT NOT NULL,           -- caminho local em dados/arquivos/ — nunca público
  criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================ ORQUESTRADOR — PLANO
-- Objetivo -> plano -> passos, persistido. A coluna resumo_raciocinio é
-- sempre curta e operacional ("Visitar site de cada prospect.") -- nunca
-- cadeia de pensamento interna do modelo, que nunca é persistida em lugar
-- nenhum.

CREATE TABLE IF NOT EXISTS planos (
  id                    TEXT PRIMARY KEY,
  job_id                TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  objetivo              TEXT NOT NULL,
  resumo_raciocinio     TEXT NOT NULL,
  origem                TEXT NOT NULL CHECK (origem IN ('deterministico','modelo')),
  agente_id             TEXT,             -- qual Agente (registro) o planejador consultou, quando houve um
  capacidades_necessarias TEXT NOT NULL,  -- JSON: lista de capacidades que o plano usa
  nivel_risco           TEXT NOT NULL DEFAULT 'baixo' CHECK (nivel_risco IN ('baixo','medio','alto')),
  exige_aprovacao       INTEGER NOT NULL DEFAULT 0,
  estado                TEXT NOT NULL DEFAULT 'RASCUNHO'
                         CHECK (estado IN ('RASCUNHO','APROVADO','EXECUTANDO','CONCLUIDO','FALHOU','ADAPTADO')),
  criado_em             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_planos_job ON planos(job_id);

CREATE TABLE IF NOT EXISTS plano_passos (
  id                 TEXT PRIMARY KEY,
  plano_id           TEXT NOT NULL REFERENCES planos(id) ON DELETE CASCADE,
  ordem              INTEGER NOT NULL,
  descricao          TEXT NOT NULL,
  capacidade         TEXT NOT NULL,       -- ex: 'visitar_site' — o planejador nunca fixa uma Tool, só a capacidade
  entrada            TEXT NOT NULL,       -- JSON
  depende_de         TEXT NOT NULL DEFAULT '[]', -- JSON: array de plano_passos.id
  nivel_permissao    TEXT,
  status             TEXT NOT NULL DEFAULT 'PENDENTE'
                     CHECK (status IN ('PENDENTE','EXECUTANDO','CONCLUIDO','FALHOU','PULADO','AGUARDANDO_APROVACAO','AGUARDANDO_FINALIZACAO')),
  saida              TEXT,                -- JSON: resultado normalizado (ver contrato de resultado de Tool)
  erro               TEXT,
  tentativas         INTEGER NOT NULL DEFAULT 0,
  max_tentativas     INTEGER NOT NULL DEFAULT 1,
  iniciado_em        TEXT,
  concluido_em       TEXT
);
CREATE INDEX IF NOT EXISTS idx_plano_passos_plano ON plano_passos(plano_id, ordem);

-- ============================================================ AGENTES (registro)
-- Configuração, não código. Criar um agente é gravar uma linha aqui — nunca
-- gerar/executar código arbitrário.

CREATE TABLE IF NOT EXISTS agentes (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  papel         TEXT NOT NULL,           -- 'prospeccao' | 'pesquisa' | ...
  objetivo      TEXT NOT NULL,
  capacidades   TEXT NOT NULL,           -- JSON: array de capacidade
  instrucoes    TEXT,
  nivel_autonomia_padrao INTEGER NOT NULL DEFAULT 1,
  estado        TEXT NOT NULL DEFAULT 'ATIVO' CHECK (estado IN ('ATIVO','INATIVO')),
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================ INTELLIGENCE ENGINE (Fase 13)
-- Free-first: fonte é registrada ANTES de custar dinheiro (custo FREE por
-- padrão) — só vira PAID/REQUIRES_CREDENTIAL quando o provedor de verdade
-- exige. Item de inteligência nunca é apagado por rotina — arquivado, não
-- destruído (histórico é dado real).

CREATE TABLE IF NOT EXISTS fontes_inteligencia (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('YOUTUBE_RSS','RSS','WEB','NEWS_API','SOCIAL','OUTRO')),
  url           TEXT NOT NULL,
  categoria     TEXT NOT NULL DEFAULT 'geral',
  ativa         INTEGER NOT NULL DEFAULT 1,
  custo         TEXT NOT NULL DEFAULT 'FREE' CHECK (custo IN ('FREE','PAID','REQUIRES_CREDENTIAL')),
  confiabilidade REAL NOT NULL DEFAULT 0.7 CHECK (confiabilidade BETWEEN 0 AND 1),
  frequencia_minutos INTEGER NOT NULL DEFAULT 360,
  config        TEXT,                     -- JSON: parâmetro específico do provedor (ex: channel_id)
  ultima_verificacao TEXT,
  ultimo_sucesso TEXT,
  ultimo_erro   TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fontes_inteligencia_ativa ON fontes_inteligencia(ativa, tipo);

CREATE TABLE IF NOT EXISTS itens_inteligencia (
  id            TEXT PRIMARY KEY,
  fonte_id      TEXT NOT NULL REFERENCES fontes_inteligencia(id) ON DELETE CASCADE,
  id_externo    TEXT NOT NULL,            -- id estável do provedor (video id, guid) — nunca duplica por fonte
  titulo        TEXT NOT NULL,
  resumo        TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL,
  url_canonica  TEXT NOT NULL,            -- normalizada (sem querystring de tracking) — usada na deduplicação
  publicado_em  TEXT,
  descoberto_em TEXT NOT NULL DEFAULT (datetime('now')),
  categoria     TEXT NOT NULL DEFAULT 'geral',
  relevancia    REAL NOT NULL DEFAULT 0 CHECK (relevancia BETWEEN 0 AND 1),
  prioridade    TEXT NOT NULL DEFAULT 'LOW' CHECK (prioridade IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  status        TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','REVIEWED','IMPORTANT','ARCHIVED','IGNORED')),
  duplicado_de  TEXT REFERENCES itens_inteligencia(id) ON DELETE SET NULL,
  analisado_por_modelo INTEGER NOT NULL DEFAULT 0,
  analise        TEXT,                    -- JSON: {fato, observacao, inferencia, desconhecido, motivo_relevancia} — nunca escrito sem análise real
  metadados     TEXT,                     -- JSON: campo bruto específico do provedor
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fonte_id, id_externo)
);
CREATE INDEX IF NOT EXISTS idx_itens_inteligencia_status ON itens_inteligencia(status, prioridade, descoberto_em DESC);
CREATE INDEX IF NOT EXISTS idx_itens_inteligencia_url ON itens_inteligencia(url_canonica);

-- Interesses configuráveis — nunca hardcoded como fato permanente do
-- Cacique (isso seria memória, não configuração). Peso decide o quanto uma
-- palavra-chave pesa na pontuação determinística de relevância.
CREATE TABLE IF NOT EXISTS interesses_inteligencia (
  id        TEXT PRIMARY KEY,
  termo     TEXT NOT NULL UNIQUE,
  categoria TEXT NOT NULL DEFAULT 'geral',
  peso      INTEGER NOT NULL DEFAULT 1 CHECK (peso BETWEEN 1 AND 5),
  ativo     INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================ SOCIAL MEDIA OPERATING SYSTEM (Fase 11)
-- Pipeline de conteúdo determinístico: IDEIA -> BRIEFING -> RASCUNHO ->
-- REVISAO -> AGUARDANDO_APROVACAO -> APROVADO/REJEITADO -> AGENDADO ->
-- PUBLICADO -> MONITORAMENTO -> ANALISADO. Cada conteúdo pode referenciar
-- o Job/Plano/Agente que o produziu (mesmo motor de execução da Fase 5+,
-- nunca um segundo motor) — mas nasce sem nenhum deles quando criado à mão.
-- Publicação real (Instagram Graph API) fica FORA desta fase — o pipeline
-- INTEIRO funciona sem credencial nenhuma, até o passo de publicar de
-- verdade, que reporta estado honesto (ver integracoes/registro.ts).

CREATE TABLE IF NOT EXISTS conteudos_sociais (
  id                TEXT PRIMARY KEY,
  titulo            TEXT NOT NULL,
  conceito          TEXT NOT NULL DEFAULT '',
  tipo_conteudo     TEXT NOT NULL DEFAULT 'post'
                    CHECK (tipo_conteudo IN ('post','reels','story','carrossel','video','texto','outro')),
  plataforma        TEXT NOT NULL DEFAULT 'instagram'
                    CHECK (plataforma IN ('instagram','facebook','whatsapp_status','linkedin','tiktok','outro')),
  legenda           TEXT NOT NULL DEFAULT '',
  midia_referencias TEXT,                  -- JSON: array de referência (URL/descrição — nunca binário aqui)
  prompt_referencia TEXT,                  -- prompt usado pra gerar (auditável, nunca escondido)
  cta               TEXT,
  hashtags          TEXT,                  -- JSON: array de string
  status            TEXT NOT NULL DEFAULT 'IDEIA'
                    CHECK (status IN (
                      'IDEIA','BRIEFING','RASCUNHO','REVISAO','AGUARDANDO_APROVACAO',
                      'APROVADO','REJEITADO','AGENDADO','PUBLICADO','FALHOU',
                      'MONITORAMENTO','ANALISADO')),
  prioridade        TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (prioridade IN ('URGENT','HIGH','MEDIUM','LOW')),
  agendado_para     TEXT,
  publicado_em      TEXT,
  criado_por        TEXT NOT NULL DEFAULT 'cacique' CHECK (criado_por IN ('cacique','jarvis')),
  agente_id         TEXT REFERENCES agentes(id) ON DELETE SET NULL,
  job_id            TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  plano_id          TEXT REFERENCES planos(id) ON DELETE SET NULL,
  motivo_rejeicao   TEXT,
  metadados_performance TEXT,              -- JSON: {alcance, curtidas, comentarios, compartilhamentos, ...} — só o que a plataforma de fato devolveu
  criado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conteudos_status ON conteudos_sociais(status, prioridade, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_conteudos_plataforma ON conteudos_sociais(plataforma, status);
CREATE INDEX IF NOT EXISTS idx_conteudos_agendado ON conteudos_sociais(agendado_para);

-- ============================================================ CONFIGURAÇÃO — AUTONOMIA
-- Uma linha só, escopo global nesta fase. Nível conservador por padrão —
-- nunca autonomia ampla sem o Cacique ter escolhido isso.

CREATE TABLE IF NOT EXISTS configuracao_autonomia (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  nivel         INTEGER NOT NULL DEFAULT 1 CHECK (nivel BETWEEN 0 AND 4),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================ AUDITORIA (append-only)

CREATE TABLE IF NOT EXISTS auditoria (
  id         TEXT PRIMARY KEY,
  quando     TEXT NOT NULL DEFAULT (datetime('now')),
  projeto_id TEXT,
  tool       TEXT,
  skill      TEXT,
  acao       TEXT NOT NULL,
  permissao  INTEGER,
  motivo     TEXT,
  entrada    TEXT,
  resultado  TEXT,
  impacto    TEXT,
  erro       TEXT,
  aprovacao  TEXT
);
CREATE INDEX IF NOT EXISTS idx_auditoria_quando ON auditoria(quando DESC);

-- Append-only de verdade: o banco recusa, não a aplicação.
CREATE TRIGGER IF NOT EXISTS auditoria_sem_update BEFORE UPDATE ON auditoria BEGIN
  SELECT RAISE(ABORT, 'auditoria e append-only: UPDATE recusado');
END;
CREATE TRIGGER IF NOT EXISTS auditoria_sem_delete BEFORE DELETE ON auditoria BEGIN
  SELECT RAISE(ABORT, 'auditoria e append-only: DELETE recusado');
END;

-- ============================================================ CONTROLE

CREATE TABLE IF NOT EXISTS esquema_versao (
  versao     INTEGER PRIMARY KEY,
  aplicado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
