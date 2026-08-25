# Referência de expansão — candidatos, não decisões

Material de missões grandes recebidas por chat (Fase 19–22) que apontam
dezenas de tecnologias/áreas candidatas a avaliar. Nada aqui está
implementado só por estar listado — ver `docs/DOUTRINA.md` para o que
existe de verdade. Este arquivo existe pra uma sessão nova não precisar
que a missão inteira seja colada de novo a cada turno.

Framework de avaliação pedido pelas próprias missões (reaproveitar
sempre, não reinventar por candidato):

```
DESCOBRIR → VERIFICAR FONTE OFICIAL → checar API/SDK/MCP/Skill →
licença → custo (produto grátis ≠ API grátis) → limite → segurança →
manutenção → compatibilidade → TESTAR → COMPARAR →
instalar SÓ SE justificado → registrar decisão (por quê sim/não)
```

Status de cada item abaixo: **NÃO PESQUISADO** (nenhuma verificação
feita ainda) a menos que dito o contrário.

## Desenvolvimento / agentes

| Item | Por que candidato | Status |
|---|---|---|
| Ralph Loop | Padrão de iteração implementar→testar→corrigir | NÃO PESQUISADO — Jarvis já tem Job engine com DAG/retentativa/aprovação; se adotado, só como conceito dentro do Job engine existente, nunca uma segunda orquestração |
| Playwright | Já é dependência real (`package.json`) | INSTALADO, sem smoke test de produção real ainda |
| Superpowers, Serena, Context7, Hooks, Sentry | Ferramentas de dev/observabilidade | NÃO PESQUISADO |
| GitHub Issue Creator | Automação de issue/PR | NÃO PESQUISADO |
| OWASP tooling | Checklist de segurança | Usado como referência conceitual na auditoria de segurança já feita (Fase 22), nenhuma ferramenta instalada |

## IA local

| Item | Nota | Status |
|---|---|---|
| Ollama | Exige avaliação de hardware real (CPU/RAM/GPU/VRAM/disco) ANTES de instalar | NÃO PESQUISADO |
| Qwen, DeepSeek, Kimi, Nemotron | Modelos candidatos pro Ollama | NÃO PESQUISADO — nenhum tem sentido sem o passo de hardware primeiro |

## Mídia (imagem/vídeo/voz/música)

| Item | Nota | Status |
|---|---|---|
| Leonardo, Midjourney, ElevenLabs, MiniMax, Kling, Veo, Suno, Udio | Cada um precisa verificação separada de API real vs. produto (achado geral: "produto grátis" quase nunca é "API grátis") | NÃO PESQUISADO |

## Integrações comerciais

| Item | Nota | Status |
|---|---|---|
| Google Ads | Arquitetura pedida: READ→ANALYZE→RECOMMEND→APPROVE→EXECUTE, write sempre com aprovação | Registro em `ferramentas/registro.ts` já tem stub `google_ads.analisar`/`google_ads.negativar` (NAO_IMPLEMENTADO/stub) |
| Meta Ads | Mesmo padrão | NÃO INICIADO |
| Instagram (pesquisa de referência) | Já existe pesquisa PÚBLICA de perfil (`src/lib/pesquisa/instagram.ts`) — o que falta é o fluxo de "referência→análise→padrão→insight" mais estruturado | PARCIAL |

## MCP / Skills

Nenhum registro formal de MCP ou Skills existe no repositório hoje —
seria um módulo novo (`src/lib/mcp/registro.ts`? `src/lib/skills/
registro.ts`?), seguindo o MESMO padrão já estabelecido em
`ferramentas/tipos.ts` (disponibilidade real, nunca "conectado" de
mentira). Não criar um sistema de registro genérico especulativo sem um
MCP/Skill real candidato pra popular — risco de abstração vazia.

## Obsidian — grafo de conhecimento e "cérebro visual"

A sincronização git (Fase 17/18) está sólida e verificada. O que a
missão pede além disso (grafo de relações Projeto→Skill→Modelo,
dashboard com Canvas/Bases/Dataview, notas automáticas de decisão/
research/aprendizado) **não existe ainda** — é a extensão mais alinhada
com o que já está pronto (o vault e a sincronização já funcionam;
falta a CAMADA de estrutura/automação em cima).

## Frontend

OriginKit, GSAP, ReactBits — bibliotecas de design mencionadas.
Princípio explícito da própria missão: só adicionar se melhorar UX de
forma material, nunca por novidade visual. Nenhuma avaliada ainda.

## Regra permanente pra todo item desta lista

Antes de instalar QUALQUER coisa daqui: confirmar que resolve um
problema real do Jarvis hoje (não "seria legal ter"), confirmar
licença/custo com a fonte oficial (nunca vídeo/propaganda), testar antes
de registrar como disponível, e documentar o motivo da decisão — inclusive
quando a decisão é "não vale a pena", pra ninguém reavaliar o mesmo
candidato do zero na próxima sessão.
