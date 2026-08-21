# Jarvis

Sistema operacional pessoal do Cacique. Repositório próprio — independente do
Locatta, do Claude-coworking e de qualquer projeto de cliente.

## Rodar

```bash
npm install
npm run dev
```

Abre em http://localhost:3000. **Funciona sem nenhuma credencial** — conversa,
memória, projetos e base de conhecimento persistem desde o primeiro segundo.

Para o Jarvis responder, copie `.env.local.exemplo` para `.env.local` e preencha
`ANTHROPIC_API_KEY`. Sem ela, as perguntas continuam sendo salvas e o sistema
diz exatamente o que falta.

## Testes

```bash
node testes/persistencia.mjs   # 82 verificações da camada de dados
node testes/api.mjs            # 38 verificações end-to-end contra a app rodando
```

O de API é idempotente: rode quantas vezes quiser, no mesmo banco.

## Onde os dados moram

`dados/jarvis.db` — SQLite via `node:sqlite` (nativo do Node 22+, zero
dependência). Ignorado pelo git.

**Por que SQLite e não Supabase agora:** criar o projeto Supabase exige login na
conta do Cacique. Em vez de escrever SQL que nunca rodou e chamar de pronto, a
persistência foi construída e verificada de verdade em SQLite. O espelho
Postgres está em `supabase/001_esquema.sql`, com pgvector, RLS e a trigger de
append-only — pronto para rodar quando o projeto existir. Toda leitura e escrita
passa por `src/lib/dados/`, então a troca é localizada.

## O que existe

**Fase 2 — núcleo.** Interface escura, reator de nove estados, conversa em
streaming, personalidade em código (Cacique/Cauan, três modos, discordância em
cinco passos, rótulos epistêmicos), roteamento de modelo por complexidade.

**Fase 4 — memória.** Dezessete tabelas. Conversa, memória, projetos e
conhecimento sobrevivem a reload, fechamento do navegador e restart do servidor.
Busca full-text com ranking BM25. Quatro abas funcionais.

### Separações que o esquema garante

| Tabela | Guarda | Expira quando |
|---|---|---|
| `memorias` | preferência e decisão do Cacique | ele muda de ideia |
| `projeto_conhecimento` | fato de repositório | o código muda |
| `trechos_conhecimento` | material de estudo, com nível de evidência | a fonte é revisada |

Misturar os dois primeiros é o pior erro possível de um segundo cérebro: tratar
uma escolha do usuário como fato técnico, ou detalhe de código obsoleto como
preferência dele.

### Governança de conhecimento

Todo trecho carrega fonte, `evidencia` (`CONSENSO_FORTE` / `CONSENSO_PARCIAL` /
`MENCAO_ISOLADA`), `natureza` (`FATO` / `HEURISTICA` / `HIPOTESE` /
`REGRA_OPERACIONAL` / `OPINIAO`) e confiança. `MENCAO_ISOLADA` nunca vira
consenso — o `CHECK` do banco recusa valor inválido.

### Conflito de versão

Decisão nova não sobrescreve a antiga. A antiga vira `DESATUALIZADA` e aponta
para a substituta. Os dois estados nunca se fundem, e o histórico continua
rastreável.

### Segurança

- Filtro de segredo roda **antes** de qualquer `INSERT` — chave de API, token,
  JWT, senha em URL são recusados com 422 nomeando o padrão.
- Denylist do indexador: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`,
  `secrets*`, `.git/config`, `node_modules/` — não lidos, não indexados, não
  enviados ao modelo.
- Auditoria append-only garantida por trigger: o banco recusa `UPDATE` e
  `DELETE`, não a aplicação.
- Caminho de máquina não existe no banco. Fica só na config do agente local.

## O que ainda não existe

Voz (Fase 3), agenda e e-mail (7–8), agendador (9), War Room executável (10),
Skills declarativas, indexação automática de repositório, embeddings.

Busca semântica está preparada — a coluna `embedding` existe nas três tabelas —
mas desligada até escolhermos o provedor mais barato que sirva. Hoje a
recuperação é FTS5/BM25, que custa zero.

## Estrutura

```
src/
  app/
    api/
      conversar/     streaming + persistência + contexto recuperado
      conversas/     CRUD, renomear, arquivar, reabrir
      memorias/      CRUD, busca, esquecer
      conhecimento/  fontes e busca
      projetos/      registro
  componentes/       Painel, Conversa, Memoria, Conhecimento, Reator
  lib/
    nucleo.ts        personalidade — bloco estável do prompt
    modelos.ts       roteador de complexidade e esforço
    contexto.ts      montagem do contexto recuperado
    dados/           esquema, conexão, repositório, busca
    seguranca/       denylist e filtro de segredo
supabase/001_esquema.sql   espelho Postgres com pgvector e RLS
testes/                    persistencia.mjs e api.mjs
```

## Regras do projeto

- Nenhuma credencial de outro projeto entra aqui.
- Locatta, Claude-coworking e Clientes são **fontes de conhecimento**, somente
  leitura. Código do Jarvis mora só neste repositório.
- Verificação real antes de declarar fase concluída. "Compila" não é "funciona".
