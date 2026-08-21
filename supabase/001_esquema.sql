-- Jarvis — esquema Postgres/Supabase
--
-- Espelho de src/lib/dados/esquema.ts. Rodar quando o projeto Supabase dedicado
-- existir. NÃO rodar contra o banco do Locatta.
--
-- Diferenças em relação ao SQLite local:
--   · uuid nativo em vez de TEXT
--   · timestamptz em vez de TEXT
--   · pgvector para busca semântica (o SQLite usa FTS5/BM25 por enquanto)
--   · RLS — o SQLite não tem equivalente; a proteção lá é o arquivo local
--
-- Sistema de um usuário: a RLS protege contra erro de código, não contra outro
-- inquilino. Vale por isso.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================ PROJETOS

CREATE TABLE projetos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL UNIQUE,
  tipo          text NOT NULL,
  proposito     text NOT NULL DEFAULT '',
  resumo        text NOT NULL DEFAULT '',
  permissao     text NOT NULL DEFAULT 'leitura'
                CHECK (permissao IN ('leitura','leitura_escrita','leitura_escrita_deploy')),
  estado        text NOT NULL DEFAULT 'ativo',
  saude         text NOT NULL DEFAULT 'verde' CHECK (saude IN ('verde','amarelo','vermelho')),
  indexado_em   timestamptz,
  arquivos      integer NOT NULL DEFAULT 0,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
  -- caminho de máquina NÃO mora aqui; fica na config do agente local
);

-- ============================================================ CONVERSAS

CREATE TABLE conversas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text NOT NULL DEFAULT 'Nova conversa',
  projeto_id    uuid REFERENCES projetos(id) ON DELETE SET NULL,
  modo          text NOT NULL DEFAULT 'direto'
                CHECK (modo IN ('consultivo','direto','socio_incomodo')),
  estado        text NOT NULL DEFAULT 'ativa' CHECK (estado IN ('ativa','arquivada')),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversas_recentes ON conversas(estado, atualizado_em DESC);

CREATE TABLE mensagens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id    uuid NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  papel          text NOT NULL CHECK (papel IN ('user','assistant','system')),
  conteudo       text NOT NULL,
  projeto_id     uuid REFERENCES projetos(id) ON DELETE SET NULL,
  modo           text,
  modelo         text,
  esforco        text,
  tokens_entrada integer,
  tokens_saida   integer,
  cache_lido     integer,
  tools_usadas   jsonb,
  estado_exec    text,
  fontes         jsonb,
  memorias_ref   jsonb,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_mensagens_conversa ON mensagens(conversa_id, criado_em);

-- ============================================================ MEMÓRIA PESSOAL

CREATE TABLE memorias (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            text NOT NULL CHECK (tipo IN (
                    'FATO','PREFERENCIA','META','PROJETO','DECISAO','TAREFA',
                    'ROTINA','OPORTUNIDADE','CONTEXTO_TEMP','SKILL','LICAO','EXPERIMENTO')),
  camada          text NOT NULL DEFAULT 'recuperavel'
                  CHECK (camada IN ('nucleo','recuperavel','estrategica','temporaria')),
  titulo          text NOT NULL,
  corpo           text NOT NULL,
  projeto_id      uuid REFERENCES projetos(id) ON DELETE SET NULL,
  origem          text NOT NULL DEFAULT 'conversa',
  confianca       real NOT NULL DEFAULT 0.7 CHECK (confianca BETWEEN 0 AND 1),
  importancia     smallint NOT NULL DEFAULT 3 CHECK (importancia BETWEEN 1 AND 5),
  estado          text NOT NULL DEFAULT 'ATIVA'
                  CHECK (estado IN ('ATIVA','DESATUALIZADA','REVOGADA','ARQUIVADA')),
  substituida_por uuid REFERENCES memorias(id) ON DELETE SET NULL,
  embedding       vector(1536),
  busca           tsvector GENERATED ALWAYS AS (
                    to_tsvector('portuguese', coalesce(titulo,'') || ' ' || coalesce(corpo,''))
                  ) STORED,
  expira_em       timestamptz,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  verificado_em   timestamptz
);
CREATE INDEX idx_memorias_ativas ON memorias(estado, importancia DESC, atualizado_em DESC);
CREATE INDEX idx_memorias_busca  ON memorias USING gin(busca);
CREATE INDEX idx_memorias_vetor  ON memorias USING hnsw (embedding vector_cosine_ops);
-- Deduplicação: um título ATIVO por projeto.
CREATE UNIQUE INDEX idx_memorias_titulo_unico
  ON memorias (lower(titulo), coalesce(projeto_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE estado = 'ATIVA';

CREATE TABLE memoria_relacoes (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  de_id     uuid NOT NULL REFERENCES memorias(id) ON DELETE CASCADE,
  para_id   uuid NOT NULL REFERENCES memorias(id) ON DELETE CASCADE,
  relacao   text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (de_id, para_id, relacao)
);

-- ============================================================ CONHECIMENTO DE PROJETO

CREATE TABLE projeto_conhecimento (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id  uuid NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  caminho     text,                          -- relativo ao projeto, nunca absoluto
  titulo      text NOT NULL,
  corpo       text NOT NULL,
  tipo        text NOT NULL DEFAULT 'fato',
  confianca   real NOT NULL DEFAULT 0.8,
  embedding   vector(1536),
  busca       tsvector GENERATED ALWAYS AS (
                to_tsvector('portuguese', coalesce(titulo,'') || ' ' || coalesce(corpo,''))
              ) STORED,
  indexado_em timestamptz NOT NULL DEFAULT now(),
  obsoleto    boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_pc_busca ON projeto_conhecimento USING gin(busca);
CREATE INDEX idx_pc_vetor ON projeto_conhecimento USING hnsw (embedding vector_cosine_ops);

-- ============================================================ METAS · TAREFAS · DECISÕES

CREATE TABLE metas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nivel        text NOT NULL CHECK (nivel IN ('vida','negocio','projeto','semana')),
  pai_id       uuid REFERENCES metas(id) ON DELETE SET NULL,
  titulo       text NOT NULL,
  alvo         text,
  estado_atual text,
  prazo        date,
  progresso    real NOT NULL DEFAULT 0,
  projeto_id   uuid REFERENCES projetos(id) ON DELETE SET NULL,
  estado       text NOT NULL DEFAULT 'ativa',
  criado_em    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tarefas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo       text NOT NULL,
  detalhe      text NOT NULL DEFAULT '',
  projeto_id   uuid REFERENCES projetos(id) ON DELETE SET NULL,
  meta_id      uuid REFERENCES metas(id) ON DELETE SET NULL,
  impacto      smallint NOT NULL DEFAULT 3 CHECK (impacto BETWEEN 1 AND 5),
  esforco_min  integer,
  urgencia     smallint NOT NULL DEFAULT 3 CHECK (urgencia BETWEEN 1 AND 5),
  prazo        date,
  origem       text NOT NULL DEFAULT 'manual',
  estado       text NOT NULL DEFAULT 'aberta'
               CHECK (estado IN ('aberta','fazendo','concluida','descartada')),
  criado_em    timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);
CREATE INDEX idx_tarefas_abertas ON tarefas(estado, urgencia DESC, impacto DESC);

CREATE TABLE decisoes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo             text NOT NULL,
  contexto           text NOT NULL DEFAULT '',
  alternativas       text NOT NULL DEFAULT '',
  escolha            text NOT NULL,
  motivo             text NOT NULL DEFAULT '',
  resultado_esperado text NOT NULL DEFAULT '',
  projeto_id         uuid REFERENCES projetos(id) ON DELETE SET NULL,
  revisar_em         date,
  resultado_real     text,
  criado_em          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_decisoes_revisao ON decisoes(revisar_em) WHERE resultado_real IS NULL;

CREATE TABLE experimentos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo     text NOT NULL,
  hipotese   text NOT NULL DEFAULT '',
  metodo     text NOT NULL DEFAULT '',
  resultado  text,
  conclusao  text,
  projeto_id uuid REFERENCES projetos(id) ON DELETE SET NULL,
  estado     text NOT NULL DEFAULT 'rodando',
  criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE licoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      text NOT NULL,
  corpo       text NOT NULL,
  origem_tipo text,
  origem_id   uuid,
  projeto_id  uuid REFERENCES projetos(id) ON DELETE SET NULL,
  confianca   real NOT NULL DEFAULT 0.6,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ BASE DE CONHECIMENTO

CREATE TABLE fontes_conhecimento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text NOT NULL,
  tipo          text NOT NULL,
  url           text,
  autor         text,
  data_fonte    date,
  categoria     text,
  tags          jsonb,
  projeto_id    uuid REFERENCES projetos(id) ON DELETE SET NULL,
  estado        text NOT NULL DEFAULT 'AGUARDANDO_CONTEUDO'
                CHECK (estado IN ('AGUARDANDO_CONTEUDO','INGERIDA','FALHOU','ARQUIVADA')),
  importado_em  timestamptz NOT NULL DEFAULT now(),
  verificado_em timestamptz,
  observacao    text
);

CREATE TABLE documentos_conhecimento (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte_id  uuid NOT NULL REFERENCES fontes_conhecimento(id) ON DELETE CASCADE,
  modulo    text,
  titulo    text NOT NULL,
  resumo    text NOT NULL DEFAULT '',
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trechos_conhecimento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id  uuid NOT NULL REFERENCES documentos_conhecimento(id) ON DELETE CASCADE,
  fonte_id      uuid NOT NULL REFERENCES fontes_conhecimento(id) ON DELETE CASCADE,
  ordem         integer NOT NULL DEFAULT 0,
  afirmacao     text NOT NULL,
  corpo         text NOT NULL,
  modulo        text,
  evidencia     text NOT NULL DEFAULT 'MENCAO_ISOLADA'
                CHECK (evidencia IN ('CONSENSO_FORTE','CONSENSO_PARCIAL','MENCAO_ISOLADA')),
  natureza      text NOT NULL DEFAULT 'HEURISTICA'
                CHECK (natureza IN ('FATO','HEURISTICA','HIPOTESE','REGRA_OPERACIONAL','OPINIAO')),
  confianca     real NOT NULL DEFAULT 0.5,
  referencias   jsonb,
  embedding     vector(1536),
  busca         tsvector GENERATED ALWAYS AS (
                  to_tsvector('portuguese', coalesce(afirmacao,'') || ' ' || coalesce(corpo,''))
                ) STORED,
  importado_em  timestamptz NOT NULL DEFAULT now(),
  verificado_em timestamptz,
  obsoleto      boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_trechos_busca  ON trechos_conhecimento USING gin(busca);
CREATE INDEX idx_trechos_vetor  ON trechos_conhecimento USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_trechos_modulo ON trechos_conhecimento(modulo) WHERE obsoleto = false;

CREATE TABLE conhecimento_relacoes (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trecho_id uuid NOT NULL REFERENCES trechos_conhecimento(id) ON DELETE CASCADE,
  alvo_tipo text NOT NULL CHECK (alvo_tipo IN ('projeto','skill','decisao','experimento','licao','oportunidade')),
  alvo_id   uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trecho_id, alvo_tipo, alvo_id)
);

-- ============================================================ SKILLS

CREATE TABLE skills (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome           text NOT NULL UNIQUE,
  descricao      text NOT NULL DEFAULT '',
  gatilho        text NOT NULL DEFAULT '',
  classe         text NOT NULL DEFAULT 'declarativa' CHECK (classe IN ('declarativa','imperativa')),
  permissao      smallint NOT NULL DEFAULT 1 CHECK (permissao BETWEEN 0 AND 4),
  tools          jsonb,
  schema_entrada jsonb,
  schema_saida   jsonb,
  implementacao  text,
  versao         integer NOT NULL DEFAULT 1,
  estado         text NOT NULL DEFAULT 'EM_TESTE'
                 CHECK (estado IN ('ATIVA','EM_TESTE','SOMBRA','DESATIVADA','FALHOU','DEPRECIADA')),
  custo_estimado real,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ AUDITORIA (append-only)

CREATE TABLE auditoria (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quando     timestamptz NOT NULL DEFAULT now(),
  projeto_id uuid,
  tool       text,
  skill      text,
  acao       text NOT NULL,
  permissao  smallint,
  motivo     text,
  entrada    jsonb,
  resultado  text,
  impacto    text,
  erro       text,
  aprovacao  text
);
CREATE INDEX idx_auditoria_quando ON auditoria(quando DESC);

CREATE OR REPLACE FUNCTION auditoria_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'auditoria é append-only: % recusado', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auditoria_sem_update BEFORE UPDATE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_append_only();
CREATE TRIGGER auditoria_sem_delete BEFORE DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_append_only();

-- ============================================================ RLS
-- Sistema privado de um usuário. Nada é legível sem sessão autenticada.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projetos','conversas','mensagens','memorias','memoria_relacoes',
    'projeto_conhecimento','metas','tarefas','decisoes','experimentos','licoes',
    'fontes_conhecimento','documentos_conhecimento','trechos_conhecimento',
    'conhecimento_relacoes','skills','auditoria'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_autenticado ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t, t
    );
  END LOOP;
END $$;

-- Auditoria: escrita permitida, alteração não (a trigger já recusa, a policy
-- deixa a intenção explícita para quem lê o esquema).
DROP POLICY IF EXISTS auditoria_autenticado ON auditoria;
CREATE POLICY auditoria_insere ON auditoria FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY auditoria_le     ON auditoria FOR SELECT TO authenticated USING (true);
