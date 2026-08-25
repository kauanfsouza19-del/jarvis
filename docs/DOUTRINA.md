# Doutrina do Jarvis

Documento permanente. Descreve o que EXISTE e FUNCIONA hoje, verificado —
nunca aspiração. Criado na Fase 22 porque as missões que chegam por chat
são grandes demais pra caber (ou precisar ser recolada) em todo turno;
isto é o que uma sessão nova do Claude deveria ler primeiro, em vez de
reler o repositório inteiro do zero.

Se este documento e o código divergirem, o código vence — atualize aqui,
nunca confie só na palavra escrita.

## O que o Jarvis é

Sistema operacional pessoal do Cacique (Cauan). Não é um chatbot — é
segundo cérebro + camada de execução, com limites explícitos (nunca
finge ser humano, nunca executa ação irreversível sozinho, nunca inventa
dado/resultado/credencial). A identidade e os limites completos vivem em
`src/lib/nucleo.ts` (`montarNucleo`) — leia ali antes de mudar tom ou
comportamento do assistente, nunca reescreva de memória.

## Regra número um

**Nunca misturar com Locatta, TX Media, Kalon ou qualquer outro
projeto do Cacique.** Vale pra código, segredo, banco, memória, estado
operacional. Reforçado dezenas de vezes ao longo da história do
projeto — não é negociável.

## Arquitetura real (verificada, não suposta)

```
mensagem
  → resolverContexto()          src/lib/contexto/resolver.ts   — determinístico, custo zero
  → orquestrar()/planejar()     src/lib/orquestrador/*         — 3 estratégias: conteúdo social,
                                                                  derivado, prospecção determinística,
                                                                  modelo (só se nenhuma bater)
  → Plano + Job persistidos     src/lib/orquestrador/repositorio.ts,
                                 src/lib/jobs/motor.ts
  → executor de plano           src/lib/jobs/handlers/plano-orquestrado.ts
       — DAG com dependência, paralelismo (LIMITE_CONCORRENCIA=3),
         expansão dinâmica, aprovação por NivelPermissao,
         retentativa adaptativa (Fase 21, só capacidades de código)
  → Tools reais                 src/lib/ferramentas/registro.ts
       — cada Tool: capacidade, nivelPermissao, exigeAprovacaoExplicita,
         implementado (nunca finge conectado), credencialNecessaria
  → resposta ao Cacique
```

Model Router (`src/lib/modelo/roteador.ts`): Anthropic real, Gemini real
(Fase 17), OpenAI **declarado mas nunca validado contra o serviço real**
(inspecionar antes de assumir "funciona"). `gerarPlano`/
`interpretarResultado`/`decidirProximoPasso` são as três operações que o
Orquestrador pede a qualquer provedor — `decidirProximoPasso` só passou
a ser chamado de verdade na Fase 21; `interpretarResultado` continua
declarado e nunca usado (candidato real de próxima fase).

Autonomia (`src/lib/autonomia.ts`): nível 0 = só sugere (Plano fica
RASCUNHO); nível 1 (padrão) = executa tarefa só-leitura sozinho. Budget
mode é dimensão separada (não confundir com nível de autonomia).

Segurança de acesso: `src/middleware.ts` + `src/lib/seguranca/
autorizacao.ts` — toda rota de API e página exige Bearer ou sessão
válida quando `JARVIS_TOKEN` está configurado (produção sempre tem);
só 5 rotas públicas, cada uma com justificativa própria documentada no
próprio arquivo (nunca "pública por omissão"). Rate limiting geral
(além do login) **não existe ainda** — gap conhecido, baixo risco real
(modelo de usuário único com token).

## Tools de código (Fase 20/21/22)

`src/lib/ferramentas/codigo.ts` — listar/ler/**escrever** arquivo, rodar
teste (allowlist), typecheck, build, git status/diff.

`codigo.escrever_arquivo` (Fase 22) é a única Tool de ESCRITA — substitui
o arquivo inteiro (nunca patch parcial), sempre com `exigeAprovacaoExplicita:
true`. Três fronteiras independentes: path (nunca sai do repo, nunca em
cima de segredo — `caminhoBloqueado` local + `arquivoBloqueado`
compartilhado com o indexador), extensão (allowlist de tipos texto/
código), conteúdo (`exigirSemSegredo`, mesmo filtro que protege a
memória desde a Fase 9).

**Achado real corrigido na Fase 22**: aprovar um passo de Plano de DAG
(não job de Tool única) nunca fazia o passo pausado voltar a rodar —
`responderAprovacao` só sabia redisparar o Job inteiro, e
`ferramentaDisponivelPara()` nunca reporta DISPONIVEL pra Tool com
aprovação, então o passo pausava DE NOVO pra sempre. Corrigido com
`aprovacoes.plano_passo_id` (nova coluna) + checagem por passo específico
em `executarPasso` (`plano-orquestrado.ts`) — mesma idempotência que
`executar-ferramenta.ts` sempre teve, agora no nível certo. Verificado
ponta a ponta: aprovar escreve de verdade, rejeitar nunca escreve e
marca o passo FALHOU sem cancelar o resto do plano
(`testes/escrita-fase22.mjs`, 14/14).

`RAIZ` lê `JARVIS_REPO_PATH` (bind mount do checkout real do host em
produção — a imagem Docker de runtime NÃO inclui `src/`/`.git`, só
`.next` compilado + `node_modules` podado, de propósito, ver Dockerfile)
com fallback pro `cwd` em dev local.

**Achado operacional real, repetido em toda fase que mexeu nisso**: depois
de QUALQUER `git pull` feito como root no host, refazer
`chown -R 100:101 /root/jarvis` (100:101 = uid:gid do usuário `jarvis`
dentro do container) — senão `tsc`/`npm run build` falham por
permissão ao escrever cache, e o próprio root perde acesso confortável
por causa do "dubious ownership" do git (mitigado com
`git config --global --add safe.directory /root/jarvis` no host, e
`-c safe.directory=RAIZ` passado por chamada dentro do container).

## Achado recorrente: conjugação verbal do português

O classificador de ação (`ACOES` em `resolver.ts`) usa regex de
substring, não morfologia real. Vários verbos só cobriam a forma
INFORMAL/indicativa ("corrige", "gera", "ajusta", "roda", "executa",
"muda", "altera", "publica") e não o **imperativo formal-você** ("gere",
"ajuste", "corrija", "rode", "execute", "mude", "altere", "publique") —
que é o registro que o Cacique usa na prática. Duas famílias de
alternância ortográfica já mapeadas:

- **c→qu** antes de e/i (explicar→explique, verificar→verifique,
  publicar→publique)
- **g→j** antes de a/o (corrigir→corrija/corrijo)

Se um verbo novo entrar em EXECUTAR/ANALISAR/RESPONDER e alguém reportar
"a mensagem X não chega no Orquestrador", a PRIMEIRA hipótese a checar é
essa — não é bug de arquitetura, é forma verbal faltando. `monta/monte`
foi **deliberadamente deixado de fora** — "monte" também é substantivo
comum, risco real de falso positivo sem solução por regex.

## Disciplina de teste — achado real, Fase 21

`git pull ... | tail -N && próximo-comando` no shell: se o pull falhar,
`tail` ainda sai com código 0 (é o último elo do pipe), e `&&` deixa o
resto da cadeia rodar mesmo assim — já aconteceu de rebuildar/deployar a
versão ERRADA sem erro visível. Sempre checar `git log --oneline -1`
depois de um pull antes de confiar nele, nunca confiar só no texto do
pipe.

Testes em `testes/*.mjs` são de dois tipos: puros (sem servidor, ~11
arquivos) e HTTP (precisam de `next dev` de pé, ~20 arquivos, todos
respeitam `JARVIS_URL`). `npm test` (Fase 22, `scripts/rodar-testes.mjs`)
roda tudo na ordem certa e derruba o servidor sozinho. Rodar o MESMO
arquivo de teste duas vezes sem esperar o teardown/limpeza terminar
contamina o banco de dev com seeds "___Teste...___" residuais — sintoma:
"criado — 200" onde deveria ser 201. Não é regressão de código quando
isso acontece; é higiene de teste.

`prospeccao-derivada.mjs` tem flakiness de rede real e documentada desde
a Fase 9 (visitas reais a sites de teste) — não tratar uma falha isolada
ali como regressão sem re-rodar primeiro.

## Deploy

Servidor: Hostinger VPS (`179.199.129.187`), Ubuntu 24.04, Docker +
Caddy (HTTPS automático). `/root/jarvis` = checkout do código (deploy
key só-leitura). `/root/jarvis-config/.env` = env real de produção,
FORA do diretório versionado. Volume persistente `jarvis_dados` em
`/app/dados` — única fronteira de persistência real (banco, vault
Obsidian, chave SSH dedicada do Obsidian).

Sequência de deploy (repetida em toda fase, nunca automatizada ainda):

```
git push (delegado ao Cacique — meu git push direto é bloqueado)
ssh → cd /root/jarvis && git pull origin master
     → git log --oneline -1   (CONFIRMAR, nunca assumir)
chown -R 100:101 /root/jarvis
docker build -t jarvis:latest .
docker stop jarvis && docker rm jarvis
docker run -d --name jarvis --restart unless-stopped \
  -p 127.0.0.1:3000:3000 --env-file /root/jarvis-config/.env \
  -v jarvis_dados:/app/dados -v /root/jarvis:/app/repo jarvis:latest
curl https://iajarvis.online/api/saude
```

Obsidian: vault próprio, repositório dedicado
(`github.com/kauanfsouza19-del/jarvis-obsidian`), sincronização git real
(`src/lib/obsidian/sync-git.ts`) com chave SSH própria (nunca a mesma do
código), estado persistido (`obsidian_sync_estado`). **Nunca mexer nisso
sem motivo concreto** — foi verificado ponta a ponta e continua sendo
reconfirmado saudável (`CONECTADO`) a cada deploy desde então.

## O que NÃO existe ainda (não fingir que existe)

- Rate limiting geral de API (só login tem proteção de força bruta)
- `interpretarResultado` integrado a algum lugar
- Validação real do provedor OpenAI contra o serviço (código existe,
  nunca testado com credencial de verdade)
- Ollama/modelo local, MCP registry formal, Skills registry formal,
  Playwright validando produção de verdade (dependência instalada, sem
  smoke test real), qualquer provedor de mídia (imagem/vídeo/voz/música)
- Continuous Work Mode persistente de verdade (existe o Job engine, que
  é a base certa pra isso — não existe o "modo" em si)
- Google Ads / Meta Ads execução real
- Rastreamento de custo real por chamada de modelo consolidado

Ver `docs/REFERENCIA-EXPANSAO.md` para o material de missões grandes
recebidas por chat que ainda não viraram trabalho real — candidatos a
avaliar, nunca a assumir como implementados.
