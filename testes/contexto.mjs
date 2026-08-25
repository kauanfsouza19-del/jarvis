/**
 * Motor de resolução de contexto — prova com os exemplos do Cacique.
 *
 * Importa o resolver .ts direto: o Node 24 remove os tipos sozinho, então o
 * teste roda contra o MESMO arquivo que a aplicação usa. Sem etapa de build e
 * sem cópia que pode divergir do original.
 *
 *   node testes/contexto.mjs
 */

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import {
  resolverContexto,
  escolherModo,
  normalizar,
  extrairSinaisProspeccao,
} from "../src/lib/contexto/resolver.ts";

let passou = 0,
  falhou = 0;
const ok = (n, c, det = "") => {
  if (c) {
    passou++;
    console.log(`  ok   ${n}${det ? ` — ${det}` : ""}`);
  } else {
    falhou++;
    console.log(`  FALHOU  ${n}${det ? ` — ${det}` : ""}`);
  }
};
const secao = (t) => console.log(`\n${t}`);

/* ── léxico montado dos dados reais, não inventado ── */

const d = new DatabaseSync(join(process.cwd(), "dados", "jarvis.db"));
const entidades = [];
const projetos = d.prepare("SELECT id, nome FROM projetos WHERE estado='ativo'").all();
const APELIDOS = {
  MARKETING: ["marketing", "mkt"],
  LOCATTA: ["locatta", "locata"],
  CLIENTES: ["clientes", "cliente"],
  CRIATIVOS: ["criativos"],
  DESENVOLVIMENTO: ["desenvolvimento", "dev"],
  PESSOAL: ["pessoal"],
  JARVIS: ["jarvis"],
};
for (const p of projetos)
  entidades.push({ id: p.id, nome: p.nome, apelidos: APELIDOS[p.nome] ?? [], genero: "projeto" });

const CLI = projetos.find((p) => p.nome === "CLIENTES");
const raizes = new Set(
  d
    .prepare("SELECT DISTINCT caminho FROM projeto_conhecimento WHERE projeto_id=?")
    .all(CLI.id)
    .map((r) => r.caminho.split(/[\\/]/)[0]),
);
for (const raiz of raizes) {
  const m = /^cliente\s*[-–]\s*(.+)$/i.exec(raiz.trim());
  if (!m) continue;
  const nome = m[1].replace(/\.(docx|pdf|md|html)$/i, "").trim();
  if (nome.length < 3) continue;
  const n = normalizar(nome);
  const palavras = n.split(" ").filter((p) => p.length > 2 && !["de", "da", "do"].includes(p));
  const apelidos = new Set();
  const longa = palavras.slice().sort((a, b) => b.length - a.length)[0];
  if (longa && longa.length >= 6) apelidos.add(longa);
  if (palavras.length >= 2) apelidos.add(`${palavras[0]} ${palavras[1]}`);
  apelidos.delete(n);
  entidades.push({
    id: `cliente:${n.replace(/\s+/g, "-")}`,
    nome,
    apelidos: [...apelidos],
    genero: "cliente",
    projetoId: CLI.id,
  });
}
d.close();

const lexico = { entidades };

console.log("MOTOR DE CONTEXTO");
console.log(
  `léxico: ${entidades.filter((e) => e.genero === "projeto").length} projeto(s), ` +
    `${entidades.filter((e) => e.genero === "cliente").length} cliente(s) — todos vindos do banco`,
);
for (const e of entidades.filter((x) => x.genero === "cliente"))
  console.log(`  cliente "${e.nome}" · apelidos: ${e.apelidos.join(", ") || "—"}`);

/* ── 1. os exemplos literais do enunciado ── */

secao("1. Exemplos literais do Cacique");

const a = resolverContexto("Sobre o Locatta, quero mudar o onboarding.", lexico);
ok("projeto inferido = LOCATTA", a.projetoNome === "LOCATTA", a.projetoNome ?? "null");
ok("intenção = PRODUTO", a.intencao === "PRODUTO", a.intencao);
ok("confiança ALTA (nomeou entidade)", a.confianca === "ALTA", a.confianca);
ok("não pergunta nada", a.pergunta === null);

const b = resolverContexto("Preciso analisar aquela campanha da SS Aquecedores.", lexico);
ok("cliente inferido = SS Aquecedores", b.clienteNome === "SS Aquecedores", b.clienteNome ?? "null");
ok("intenção = AUDITORIA_ADS", b.intencao === "AUDITORIA_ADS", b.intencao);
ok("ação = ANALISAR", b.acao === "ANALISAR", b.acao);
ok("projeto do cliente = CLIENTES", b.projetoNome === "CLIENTES", b.projetoNome ?? "null");

const c = resolverContexto("Quero criar 10 criativos novos.", lexico);
ok("intenção = PRODUCAO_CRIATIVA", c.intencao === "PRODUCAO_CRIATIVA", c.intencao);
ok("ação = EXECUTAR", c.acao === "EXECUTAR", c.acao);

/* ── 2. níveis de confiança do enunciado ── */

secao("2. Confiança — os três casos especificados");

const alta = resolverContexto("Sobre o Locatta...", lexico);
ok("ALTA: 'Sobre o Locatta...'", alta.confianca === "ALTA", alta.confianca);

const media = resolverContexto("Quero mexer no onboarding.", lexico, [
  { projetoId: "p1", projetoNome: "LOCATTA", clienteId: null, clienteNome: null, intencao: "PRODUTO" },
]);
ok("MÉDIA: 'Quero mexer no onboarding' com timeline", media.confianca === "MEDIA", media.confianca);
ok("MÉDIA herda projeto da timeline", media.projetoNome === "LOCATTA", media.projetoNome ?? "null");

const baixa = resolverContexto("Preciso revisar isso.", lexico);
ok("BAIXA: 'Preciso revisar isso.'", baixa.confianca === "BAIXA", baixa.confianca);
ok(
  "BAIXA faz UMA pergunta",
  typeof baixa.pergunta === "string" && baixa.pergunta.length > 0,
  baixa.pergunta ?? "",
);
ok("BAIXA não inventa projeto", baixa.projetoNome === null);

// Fase 19 — achado real: pergunta genérica travava em BAIXA/"qual
// projeto?" antes de chegar no modelo, mesmo sem precisar de projeto
// nenhum pra ser respondida. AÇÃO=RESPONDER agora vira MEDIA (nunca
// pergunta de esclarecimento), sem projeto inventado.
const perguntaGeral1 = resolverContexto("Como você está hoje?", lexico);
ok("pergunta geral NÃO cai em BAIXA (não trava pedindo projeto)", perguntaGeral1.confianca !== "BAIXA", perguntaGeral1.confianca);
ok("pergunta geral não gera pergunta de esclarecimento", perguntaGeral1.pergunta === null);
ok("pergunta geral não inventa projeto", perguntaGeral1.projetoNome === null);

const perguntaGeral2 = resolverContexto("Explique recursão.", lexico);
ok("'Explique recursão' também não trava (RESPONDER genérico, forma 'explique')", perguntaGeral2.confianca !== "BAIXA", perguntaGeral2.confianca);

// Achado real (Fase 19): "fazer" é ao mesmo tempo verbo de ordem
// (EXECUTAR: "faça isso") e verbo de capacidade em pergunta ("capaz de
// fazer") — sem RESPONDER checado antes de EXECUTAR, esta frase-exemplo
// da própria missão cairia em EXECUTAR/BAIXA e travaria pedindo projeto.
const perguntaCapacidade = resolverContexto("Explique o que o Jarvis é capaz de fazer hoje.", lexico);
ok(
  "pergunta de capacidade com 'fazer' não vira EXECUTAR/BAIXA — RESPONDER vence",
  perguntaCapacidade.acao === "RESPONDER" && perguntaCapacidade.confianca !== "BAIXA",
  `acao=${perguntaCapacidade.acao} confianca=${perguntaCapacidade.confianca}`,
);

// "Jarvis" É um projeto real cadastrado — isto já deveria (e continua)
// resolvendo com confiança ALTA, nomeando o projeto certo, nunca BAIXA.
const perguntaSobreJarvis = resolverContexto("Me explique como está o Jarvis hoje.", lexico);
ok("pergunta sobre 'o Jarvis' reconhece o projeto de verdade (ALTA, não BAIXA)", perguntaSobreJarvis.confianca === "ALTA", perguntaSobreJarvis.confianca);
ok("projeto identificado corretamente como JARVIS", perguntaSobreJarvis.projetoNome === "JARVIS", perguntaSobreJarvis.projetoNome ?? "null");

// Continua BAIXA quando é EXECUTAR sem alvo — ação de verdade, não pergunta.
const acaoSemAlvo = resolverContexto("Corrija esse problema na autenticação.", lexico);
ok("ação sem projeto/cliente nomeado CONTINUA em BAIXA (não é pergunta, é ordem sem alvo)", acaoSemAlvo.confianca === "BAIXA", acaoSemAlvo.confianca);
ok("mas a ação em si É reconhecida como EXECUTAR (achado: 'corrig' não casava 'corrija')", acaoSemAlvo.acao === "EXECUTAR", acaoSemAlvo.acao);

// Regressão (Fase 20 — missão de agente): "corrig" não casava a conjugação
// formal "corrija"/"corrijo" (mesma alternância g→j de corrigir antes de
// a/o), e "gera"/"ajusta"/"implementa" não casavam a forma imperativa
// formal-você "gere"/"ajuste"/"implemente" — o registro que a própria
// missão usa em todos os seus exemplos. Cobertura das 12 frases pedidas.
secao("2b. Conjugação de EXECUTAR — regressão completa (Fase 20)");

const rCorrigirLogin = resolverContexto("Corrija o problema do login do Jarvis.", lexico);
ok("'Corrija o problema do login do Jarvis.' → EXECUTAR + JARVIS + ALTA", rCorrigirLogin.acao === "EXECUTAR" && rCorrigirLogin.confianca === "ALTA" && rCorrigirLogin.projetoNome === "JARVIS", `acao=${rCorrigirLogin.acao} confianca=${rCorrigirLogin.confianca} projeto=${rCorrigirLogin.projetoNome}`);

const rCorrigirLocatta = resolverContexto("Corrija o onboarding do Locatta.", lexico);
ok("'Corrija o onboarding do Locatta.' → EXECUTAR + LOCATTA + ALTA", rCorrigirLocatta.acao === "EXECUTAR" && rCorrigirLocatta.confianca === "ALTA" && rCorrigirLocatta.projetoNome === "LOCATTA", `acao=${rCorrigirLocatta.acao} confianca=${rCorrigirLocatta.confianca} projeto=${rCorrigirLocatta.projetoNome}`);

const rCorrigirInf = resolverContexto("Corrigir o problema do login.", lexico);
ok("'Corrigir o problema do login.' → EXECUTAR (infinitivo, sem alvo → BAIXA)", rCorrigirInf.acao === "EXECUTAR" && rCorrigirInf.confianca === "BAIXA", `acao=${rCorrigirInf.acao} confianca=${rCorrigirInf.confianca}`);

const rCorrigeInformal = resolverContexto("Corrige esse problema.", lexico);
ok("'Corrige esse problema.' → EXECUTAR (informal, já funcionava)", rCorrigeInformal.acao === "EXECUTAR", rCorrigeInformal.acao);

const rCrie = resolverContexto("Crie 10 criativos.", lexico);
ok("'Crie 10 criativos.' → EXECUTAR + CRIATIVOS + ALTA", rCrie.acao === "EXECUTAR" && rCrie.confianca === "ALTA" && rCrie.projetoNome === "CRIATIVOS", `acao=${rCrie.acao} confianca=${rCrie.confianca} projeto=${rCrie.projetoNome}`);

const rCriar = resolverContexto("Criar 10 criativos.", lexico);
ok("'Criar 10 criativos.' → EXECUTAR + CRIATIVOS + ALTA", rCriar.acao === "EXECUTAR" && rCriar.confianca === "ALTA" && rCriar.projetoNome === "CRIATIVOS", `acao=${rCriar.acao} confianca=${rCriar.confianca} projeto=${rCriar.projetoNome}`);

const rGere = resolverContexto("Gere uma nova campanha.", lexico);
ok("'Gere uma nova campanha.' → EXECUTAR (achado: 'gera/gerar' não casava 'gere')", rGere.acao === "EXECUTAR", rGere.acao);

const rGerar = resolverContexto("Gerar uma nova campanha.", lexico);
ok("'Gerar uma nova campanha.' → EXECUTAR (infinitivo, já funcionava)", rGerar.acao === "EXECUTAR", rGerar.acao);

const rImplemente = resolverContexto("Implemente essa funcionalidade.", lexico);
ok("'Implemente essa funcionalidade.' → EXECUTAR (achado: 'implementa' não casava 'implemente')", rImplemente.acao === "EXECUTAR", rImplemente.acao);

const rImplementar = resolverContexto("Implementar essa funcionalidade.", lexico);
ok("'Implementar essa funcionalidade.' → EXECUTAR (infinitivo, já funcionava)", rImplementar.acao === "EXECUTAR", rImplementar.acao);

const rAjuste = resolverContexto("Ajuste esse fluxo.", lexico);
ok("'Ajuste esse fluxo.' → EXECUTAR (achado: 'ajusta' não casava 'ajuste')", rAjuste.acao === "EXECUTAR", rAjuste.acao);

const rAjustar = resolverContexto("Ajustar esse fluxo.", lexico);
ok("'Ajustar esse fluxo.' → EXECUTAR (infinitivo, já funcionava)", rAjustar.acao === "EXECUTAR", rAjustar.acao);

// Distinção preservada: RESPONDER continua vencendo pergunta de verdade,
// mesmo com verbo de EXECUTAR embutido — nunca "todo imperativo vira alta
// confiança" (a missão pede correção semântica, não confiança global).
const rPerguntaComVerbo = resolverContexto("Explique como corrigir esse tipo de problema.", lexico);
ok("pergunta com verbo de EXECUTAR embutido continua RESPONDER, não EXECUTAR", rPerguntaComVerbo.acao === "RESPONDER", rPerguntaComVerbo.acao);

// Achados reais (Fase 21 — testando o próprio fluxo de agente em
// produção): "liste"/"listar" faltavam em EXECUTAR (pedido de código real
// caía em INDEFINIDA e nunca chegava no Orquestrador); "verifica" tinha o
// mesmo problema de "explica"/"corrig" — nunca casava "verifique" (mesma
// alternância c→qu de publicar/explicar).
const rListe = resolverContexto("Liste os arquivos do Jarvis.", lexico);
ok("'Liste os arquivos do Jarvis.' → EXECUTAR (achado: 'listar'/'liste' não existia)", rListe.acao === "EXECUTAR", rListe.acao);

const rListar = resolverContexto("Listar os arquivos do Jarvis.", lexico);
ok("'Listar os arquivos do Jarvis.' → EXECUTAR", rListar.acao === "EXECUTAR", rListar.acao);

const rVerifique = resolverContexto("Verifique se há erros de typecheck no Jarvis.", lexico);
ok(
  "'Verifique se há erros de typecheck no Jarvis.' → ANALISAR (achado: 'verifica' não casava 'verifique')",
  rVerifique.acao === "ANALISAR" && rVerifique.projetoNome === "JARVIS",
  `acao=${rVerifique.acao} projeto=${rVerifique.projetoNome}`,
);

/* ── 3. modo interno, sem seletor ── */

secao("3. Modo escolhido pelo sistema");

const m1 = escolherModo(
  "Sobre o Locatta, quero melhorar o onboarding. Acho que precisamos colocar mais passos.",
  "NORMAL",
);
ok("hipótese + risco → SÓCIO INCÔMODO", m1.modo === "socio_incomodo", m1.motivo);

const m2 = escolherModo("Vale mais a pena investir em Google ou Meta?", "NORMAL");
ok("opções em aberto → CONSULTIVO", m2.modo === "consultivo", m2.motivo);

const m3 = escolherModo("Indexa o projeto de novo.", "NORMAL");
ok("ordem clara → DIRETO", m3.modo === "direto", m3.motivo);

const m4 = escolherModo("A conta caiu, parou tudo agora.", "CRITICA");
ok("urgência crítica → DIRETO", m4.modo === "direto", m4.motivo);

const m5 = escolherModo("Quero dobrar a verba de todos os clientes.", "NORMAL");
ok("risco sem urgência → SÓCIO INCÔMODO", m5.modo === "socio_incomodo", m5.motivo);

/* ── 4. uma conversa, muitos contextos ── */

secao("4. Uma conversa, vários contextos");

const timeline = [];
const passo = (texto) => {
  const r = resolverContexto(texto, lexico, timeline);
  timeline.push({
    projetoId: r.projetoId,
    projetoNome: r.projetoNome,
    clienteId: r.clienteId,
    clienteNome: r.clienteNome,
    intencao: r.intencao,
  });
  return r;
};

const p1 = passo("Sobre o Locatta, quero revisar o onboarding.");
ok("passo 1 = LOCATTA", p1.projetoNome === "LOCATTA", p1.projetoNome ?? "null");

const p2 = passo("Agora vamos para a SS Aquecedores.");
ok("passo 2 troca para SS Aquecedores", p2.clienteNome === "SS Aquecedores", p2.clienteNome ?? "null");

const p3 = passo("Voltando para o Locatta, e o cadastro?");
ok("passo 3 volta para LOCATTA", p3.projetoNome === "LOCATTA", p3.projetoNome ?? "null");
ok("passo 3 não arrasta o cliente anterior", p3.clienteNome === null, p3.clienteNome ?? "null");
ok("timeline guardou os 3 contextos", timeline.length === 3, `${timeline.length}`);

/* ── 5. correção natural de contexto ── */

secao("5. Correção natural");

const corr = resolverContexto("Não, estou falando do cliente SS Aquecedores.", lexico, [
  { projetoId: "p1", projetoNome: "LOCATTA", clienteId: null, clienteNome: null, intencao: "PRODUTO" },
]);
ok("correção detectada", corr.correcao === true);
ok("correção troca o contexto na hora", corr.clienteNome === "SS Aquecedores", corr.clienteNome ?? "null");
ok("correção com alvo mantém confiança ALTA", corr.confianca === "ALTA", corr.confianca);

const corrVaga = resolverContexto("Não, na verdade não era isso.", lexico, [
  { projetoId: "p1", projetoNome: "LOCATTA", clienteId: null, clienteNome: null, intencao: "PRODUTO" },
]);
ok("correção SEM alvo cai para BAIXA", corrVaga.confianca === "BAIXA", corrVaga.confianca);
ok("correção sem alvo pergunta o alvo", (corrVaga.pergunta ?? "").length > 0, corrVaga.pergunta ?? "");

/* ── 6. não casar onde não deve ── */

secao("6. Falsos positivos");

const fp1 = resolverContexto("Qual é o assunto principal?", lexico);
ok('"assunto" não vira cliente', fp1.clienteNome === null, fp1.clienteNome ?? "null");

const fp2 = resolverContexto("Preciso de um desenvolvimento melhor disso.", lexico);
ok('"desenvolvimento" casa o projeto real', fp2.projetoNome === "DESENVOLVIMENTO", fp2.projetoNome ?? "null");

const fp3 = resolverContexto("Estou com pressa mas sem contexto.", lexico);
ok("frase vazia não inventa entidade", fp3.projetoNome === null && fp3.clienteNome === null);

// Achado testando ao vivo no navegador: "Agora quero..." é troca de assunto,
// não urgência. "agora" sozinho estava marcando CRÍTICA.
const fp4 = resolverContexto("Agora quero analisar a SS Aquecedores.", lexico);
ok('"Agora" de transição não vira urgência CRÍTICA', fp4.urgencia !== "CRITICA", fp4.urgencia);

const fp5 = resolverContexto("Isso é urgente, faz agora mesmo.", lexico);
ok("urgência real com 'agora mesmo' continua CRÍTICA", fp5.urgencia === "CRITICA", fp5.urgencia);

/* ── 7. rastreabilidade ── */

secao("7. Rastreabilidade");

const aud = resolverContexto("Analisa a campanha da SS Aquecedores urgente.", lexico);
ok("urgência CRÍTICA detectada", aud.urgencia === "CRITICA", aud.urgencia);
ok(
  "todo sinal tem origem",
  aud.sinais.every((s) => ["texto", "timeline", "padrao"].includes(s.origem)),
);
ok(
  "sinal de cliente aponta o trecho casado",
  aud.sinais.some((s) => s.campo === "cliente" && s.trecho),
);
ok("rótulo legível montado", aud.rotulo.includes("SS Aquecedores"), aud.rotulo);

/* ── 8. prospecção — motor de dinheiro primário ── */

secao("8. Prospecção — exemplos literais do Cacique");

const pro1 = resolverContexto("Procura pizzarias que não fazem tráfego perto de Osasco.", lexico);
ok("intenção = PROSPECCAO", pro1.intencao === "PROSPECCAO", pro1.intencao);
const sinaisPro1 = extrairSinaisProspeccao("Procura pizzarias que não fazem tráfego perto de Osasco.");
ok("vertical = delivery_pizzaria", sinaisPro1.vertical === "delivery_pizzaria", sinaisPro1.vertical ?? "null");
ok("localização = Osasco", sinaisPro1.localizacao === "Osasco", sinaisPro1.localizacao ?? "null");

const pro2 = resolverContexto("Procura hamburguerias perto daqui com presença digital ruim.", lexico);
ok("hamburgueria também resolve PROSPECCAO", pro2.intencao === "PROSPECCAO", pro2.intencao);

const pro3 = resolverContexto("Quero e-commerces com Shopify que parecem ter tráfego pago fraco.", lexico);
ok("e-commerce resolve PROSPECCAO", pro3.intencao === "PROSPECCAO", pro3.intencao);
const sinaisPro3 = extrairSinaisProspeccao("Quero e-commerces com Shopify que parecem ter tráfego pago fraco.");
ok("vertical = ecommerce", sinaisPro3.vertical === "ecommerce", sinaisPro3.vertical ?? "null");

ok(
  "não confunde 'procura' de conhecimento com prospecção",
  resolverContexto("Procura na base o que já sei sobre negativação.", lexico).intencao !== "PROSPECCAO",
);

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
