# Imagem de produção. Node 24 (mesma major já usada e testada neste
# ambiente de dev — node:sqlite nativo, sem flag experimental). Alpine é
# seguro aqui: node:sqlite é embutido no binário do Node, não é um módulo
# nativo separado compilado via node-gyp que dependeria de glibc.
#
# NÃO usa `output: "standalone"` (Fase 15/16) — testado e descartado: o
# tracer do standalone (Next 16/Turbopack) copiava `dados/` inteiro (banco
# real, exports reais) pra dentro do artefato de build, mesmo com
# `outputFileTracingExcludes` configurado (sem efeito nesta versão). O
# caminho padrão (`next build` + `next start`) não tem esse passo de cópia
# de árvore — nunca teve esse risco. `npm prune --omit=dev` depois do
# build tira as devDependencies sem depender de tracer nenhum — testado
# empiricamente que `next start` roda sem `typescript` instalado, mesmo
# precisando ler `next.config.ts` em runtime (o `headers()` é avaliado por
# request, não só no build).
#
# CMD chama o binário do Next direto (não `npm start`) — `npm` como PID 1
# não repassa SIGTERM de forma confiável pro processo filho em todo
# ambiente; a Railway manda SIGTERM em todo redeploy/restart, e sem repasse
# correto o container leva o tempo todo do timeout de shutdown até morrer
# à força, em vez de encerrar limpo.
#
# Build:  docker build -t jarvis .
# Run:    docker run -p 3000:3000 --env-file .env.local -v jarvis_dados:/app/dados jarvis
#
# O volume em /app/dados é OBRIGATÓRIO em produção — sem ele, o banco
# SQLite, o vault do Obsidian e os backups locais (dados/backups/, Fase 16)
# desaparecem a cada restart do container (mesmo problema, mesma razão, que
# descartou hospedagem serverless — ver relatório da fase).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# git + openssh-client (Fase 18) — a sincronização do vault Obsidian
# (lib/obsidian/sync-git.ts) chama `git` de dentro do próprio processo
# Node, que roda AQUI dentro do container, não no host. Sem isto, a
# sincronização falharia com "git: command not found" mesmo com a chave
# SSH montada corretamente.
RUN apk add --no-cache git openssh-client
RUN addgroup -S jarvis && adduser -S jarvis -G jarvis
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
RUN mkdir -p /app/dados && chown -R jarvis:jarvis /app/dados
USER jarvis
EXPOSE 3000
# A Railway injeta a própria PORT em runtime — isto é só o default pra
# `docker run` local sem -e PORT explícito. `next start` já lê PORT
# sozinho (comportamento nativo do Next.js), nenhum código precisou mudar.
ENV PORT=3000
CMD ["node_modules/.bin/next", "start"]
