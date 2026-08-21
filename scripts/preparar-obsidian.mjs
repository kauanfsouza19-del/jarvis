/**
 * Preparação de vault Obsidian (Fase 7, reestruturado na Fase 8 pro esquema
 * numerado) — cria SÓ o que dá pra criar sem intervenção do Cacique:
 * estrutura de pastas, templates, nota-índice populada com dado REAL do
 * banco (nunca placeholder fixo). O que exige ação externa (abrir o
 * Obsidian de verdade e apontar pra esta pasta, instalar plugin, configurar
 * sync) fica documentado no final, nunca fingido como já feito.
 *
 * Obsidian é camada de conhecimento EXTERNA, legível por humano — nunca a
 * fonte de verdade. O banco do Jarvis continua sendo isso; este vault é
 * espelho/complemento.
 *
 * Idempotente — rodar de novo não duplica nem sobrescreve nota que o
 * Cacique já editou manualmente (só cria o que ainda não existe).
 *
 *   node scripts/preparar-obsidian.mjs
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ_VAULT = process.env.OBSIDIAN_VAULT_PATH ?? join(process.cwd(), "dados", "obsidian-vault");
const CAMINHO_DB = process.env.JARVIS_DB ?? join(process.cwd(), "dados", "jarvis.db");

// Esquema numerado pedido na Fase 8 — a ordem numérica é a ordem de leitura
// natural (inbox não processado primeiro, arquivo morto por último).
const PASTAS = [
  "00_Inbox",
  "01_Memory",
  "02_Knowledge",
  "03_Strategies",
  "04_Clients",
  "05_Prospects",
  "06_Sales",
  "07_Marketing",
  "08_Research",
  "09_Decisions",
  "10_Experiments",
  "11_Lessons",
  // Fase 9 — faltavam no esquema numerado da Fase 8: Agentes (papel/
  // capacidade/tier de modelo) e Jobs (rastro operacional legível fora do
  // banco). Acrescentadas ao FIM da numeração existente — nunca renomeado
  // do zero, pra não invalidar link/nota que o Cacique já possa ter
  // editado manualmente dentro de 00_Inbox..11_Lessons.
  "12_Agents",
  "13_Jobs",
  // Fase 11 — Social Media Operating System: conteúdo/insight durável (ver
  // social/memoria.ts) precisa de um lar próprio, distinto de 07_Marketing
  // (que é sinal de marketing digital OBSERVADO em prospect, não conteúdo
  // que o próprio Jarvis produziu).
  "14_Social",
  // Fase 13 — Intelligence Engine: só inteligência SINTETIZADA (item
  // CRITICAL com análise real de modelo, ver inteligencia/memoria.ts) —
  // RSS cru nunca vem parar aqui, fica só no banco (Rule 11).
  "15_Intelligence",
  "99_Archive",
  "_Templates",
];

function escreverSeNaoExiste(caminho, conteudo) {
  if (existsSync(caminho)) {
    console.log(`  já existe, preservado: ${caminho}`);
    return false;
  }
  writeFileSync(caminho, conteudo, "utf8");
  console.log(`  criado: ${caminho}`);
  return true;
}

console.log(`Preparando vault Obsidian em: ${RAIZ_VAULT}\n`);
mkdirSync(RAIZ_VAULT, { recursive: true });
for (const pasta of PASTAS) mkdirSync(join(RAIZ_VAULT, pasta), { recursive: true });

// ── templates ──
escreverSeNaoExiste(
  join(RAIZ_VAULT, "_Templates", "Cliente.md"),
  `---
tipo: cliente
criado_em: {{date}}
estado: ativo
---

# {{title}}

## Contexto
-

## Decisões
-

## Histórico
-
`,
);

escreverSeNaoExiste(
  join(RAIZ_VAULT, "_Templates", "Decisao.md"),
  `---
tipo: decisao
criado_em: {{date}}
confianca:
provenance:
---

# {{title}}

## Contexto

## Decisão

## Motivo

## Revisar quando
`,
);

escreverSeNaoExiste(
  join(RAIZ_VAULT, "_Templates", "Prospect.md"),
  `---
tipo: prospect
score:
classificacao:
---

# {{title}}

## Evidência
-

## Ângulo de venda

## Próxima ação
`,
);

escreverSeNaoExiste(
  join(RAIZ_VAULT, "_Templates", "Conhecimento.md"),
  `---
tipo: conhecimento
confianca:
provenance:
origem_memoria_id:
---

# {{title}}

## Fato

## Fonte

## Quando revisar
`,
);

// Fase 14/2 — faltavam templates pras 4 pastas mais novas (12/13/14/15),
// que só tinham a entrada no índice, nunca o modelo de nota em si.
escreverSeNaoExiste(
  join(RAIZ_VAULT, "_Templates", "Agente.md"),
  `---
tipo: agente
criado_em: {{date}}
papel:
objetivo:
nivel_autonomia_padrao:
estado: ATIVO
---

# {{title}}

## Papel

## Objetivo

## Capacidades

## Instruções específicas

## Histórico de decisões relevantes
`,
);

escreverSeNaoExiste(
  join(RAIZ_VAULT, "_Templates", "Job.md"),
  `---
tipo: job
criado_em: {{date}}
job_id:
tool:
status:
custo_usd:
---

# {{title}}

## O que foi pedido

## O que foi feito

## Resultado

## Aprendizado (só se for reutilizável — nunca log bruto)
`,
);

escreverSeNaoExiste(
  join(RAIZ_VAULT, "_Templates", "Inteligencia.md"),
  `---
tipo: inteligencia
criado_em: {{date}}
fonte:
url:
prioridade:
confianca:
provenance:
---

# {{title}}

## Achado

## Por que importa

## Ação sugerida (se houver)
`,
);

escreverSeNaoExiste(
  join(RAIZ_VAULT, "_Templates", "ConteudoSocial.md"),
  `---
tipo: conteudo_social
criado_em: {{date}}
plataforma:
status:
publicado_em:
---

# {{title}}

## Conceito

## Legenda

## Resultado (preencher depois de ANALISADO)

## Aprendizado
`,
);

// ── índice, populado com dado REAL do banco (nunca fixo) ──
let linhasProjetos = "_Banco não encontrado — rode com o servidor já inicializado ao menos uma vez._";
let contagens = { memorias: 0, prospects: 0, conversas: 0, agentesAtivos: 0, jobsAtivos: 0, conteudoAguardando: 0, inteligenciaImportante: 0 };
if (existsSync(CAMINHO_DB)) {
  const d = new DatabaseSync(CAMINHO_DB, { readOnly: true });
  const projetos = d.prepare("SELECT nome, estado FROM projetos ORDER BY nome").all();
  linhasProjetos = projetos.length > 0 ? projetos.map((p) => `- [[04_Clients/${p.nome}|${p.nome}]] — ${p.estado}`).join("\n") : "_Nenhum projeto cadastrado ainda._";
  contagens.memorias = d.prepare("SELECT COUNT(*) n FROM memorias WHERE estado='ATIVA'").get().n;
  contagens.prospects = d.prepare("SELECT COUNT(*) n FROM prospects").get().n;
  contagens.conversas = d.prepare("SELECT COUNT(*) n FROM conversas").get().n;
  // Fase 14/2 — os 4 números que faltavam (só existia memória/prospect/
  // conversa, das Fases 7-8; nada das Fases 9-13 aparecia aqui ainda).
  contagens.agentesAtivos = d.prepare("SELECT COUNT(*) n FROM agentes WHERE estado='ATIVO'").get().n;
  contagens.jobsAtivos = d.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('FILA','EXECUTANDO')").get().n;
  contagens.conteudoAguardando = d.prepare("SELECT COUNT(*) n FROM conteudos_sociais WHERE status='AGUARDANDO_APROVACAO'").get().n;
  contagens.inteligenciaImportante = d.prepare("SELECT COUNT(*) n FROM itens_inteligencia WHERE prioridade IN ('CRITICAL','HIGH') AND status='NEW'").get().n;
  for (const p of projetos) {
    escreverSeNaoExiste(join(RAIZ_VAULT, "04_Clients", `${p.nome}.md`), `---\ntipo: cliente\nestado: ${p.estado}\n---\n\n# ${p.nome}\n\n## Contexto\n-\n\n## Decisões\n-\n`);
  }
  d.close();
}

// Único arquivo do vault que SEMPRE regenera (todo o resto é
// escreverSeNaoExiste — nunca pisa em nota que o Cacique editou à mão).
// Faz sentido só pra este: é 100% derivado do banco, a própria nota já
// avisa "não é sincronizado ao vivo" — deixar `escreverSeNaoExiste` aqui
// significava que ficava com a mesma foto do dia em que rodou pela
// primeira vez, pra sempre (achado real nesta fase: estava com 1 dia de
// atraso já na primeira checagem).
writeFileSync(
  join(RAIZ_VAULT, "00_Inbox", "_index.md"),
  `---
tipo: indice
atualizado_em: ${new Date().toISOString().slice(0, 10)}
---

# Jarvis — Índice

Vault preparado automaticamente (Fases 7-8, números estendidos na Fase 14/2).
Este índice reflete o estado do banco no momento em que
\`scripts/preparar-obsidian.mjs\` rodou — não é sincronizado ao vivo (rode de
novo pra atualizar). Único arquivo do vault que sempre regenera; todo o
resto preserva edição manual.

O banco do Jarvis (\`dados/jarvis.db\`) continua sendo a fonte de verdade —
este vault é uma camada de leitura humana complementar, nunca o inverso.

## Clientes
${linhasProjetos}

## Números atuais
- Memórias ativas: ${contagens.memorias}
- Prospects cadastrados: ${contagens.prospects}
- Conversas: ${contagens.conversas}
- Agentes ativos: ${contagens.agentesAtivos}
- Jobs em fila/execução agora: ${contagens.jobsAtivos}
- Conteúdo social aguardando aprovação: ${contagens.conteudoAguardando}
- Itens de inteligência importantes não revisados: ${contagens.inteligenciaImportante}

## Pastas
- **00_Inbox** — o que ainda não foi processado/classificado
- **01_Memory** — espelho legível da memória pessoal do Jarvis
- **02_Knowledge** — fatos e lições promovidos (nunca toda conversa — só o que passa confiança/proveniência/reuso, ver seção 14 da Fase 8)
- **03_Strategies** — abordagens e táticas em uso
- **04_Clients** — uma nota por projeto/cliente
- **05_Prospects** — prospects de destaque, ligados ao resultado de origem
- **06_Sales** — abordagens geradas, pipeline comercial
- **07_Marketing** — sinais e análises de marketing digital coletados
- **08_Research** — resultado de pesquisa web/Instagram
- **09_Decisions** — decisões registradas, com motivo e confiança
- **10_Experiments** — hipóteses e testes em andamento
- **11_Lessons** — o que funcionou/não funcionou, por quê
- **12_Agents** — um resumo por Agente (papel, capacidades, tier de modelo preferido)
- **13_Jobs** — rastro legível de jobs relevantes (nunca todo job — só os que valem nota, ver Fase 9)
- **14_Social** — ângulo/CTA de conteúdo social que se mostrou durável (nunca toda legenda gerada, ver Fase 11)
- **15_Intelligence** — inteligência de mercado sintetizada (nunca item de RSS cru, ver Fase 13)
- **99_Archive** — arquivado, fora do fluxo ativo
- **_Templates** — modelos de nota
`,
);

console.log("\nEstrutura pronta. O que ainda exige ação do Cacique (não pode ser automatizado daqui):");
console.log("  1. Abrir o Obsidian de verdade e escolher esta pasta como vault:");
console.log(`     ${RAIZ_VAULT}`);
console.log("  2. Instalar plugins, se quiser (Dataview etc.) — decisão de UI/preferência pessoal.");
console.log("  3. Configurar sync entre dispositivos, se aplicável — fora do controle do Jarvis.");
