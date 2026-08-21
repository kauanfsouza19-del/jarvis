/**
 * Motor de prospecção — pontuação (função pura) + navegador real (Playwright)
 * + persistência (dedup, diagnóstico, score gravado).
 *
 *   node testes/prospeccao.mjs
 */

import { DatabaseSync } from "node:sqlite";
import {
  pontuarProspect,
  chaveDeduplicacao,
} from "../src/lib/prospeccao/pontuacao.ts";

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

console.log("MOTOR DE PROSPECÇÃO");

/* ── 1. pontuação — casos reais de negócio ── */

secao("1. Pontuação — sem site é dor real, não bônus");

const semNada = pontuarProspect({
  vertical: "delivery_pizzaria",
  temWebsite: false,
  temWhatsapp: false,
  temInstagram: false,
  temEmail: false,
  temTelefone: false,
  temMetaPixel: null,
  temGtm: null,
  temGa4: null,
  viewportMobile: null,
  plataformaEcommerce: null,
  cnpjEncontrado: false,
});
ok("prospect sem nenhum canal tem score baixo", semNada.score < 20, `${semNada.score}`);
ok("contatabilidade mínima é 1, não 0", semNada.contatabilidade === 1);
ok("aponta oportunidade de site/LP", semNada.oportunidades.includes("website_lp"));
ok("fatoresAusentes existe e é honesto", semNada.fatoresAusentes.length > 0);

const semRastreio = pontuarProspect({
  vertical: "delivery_hamburgueria",
  temWebsite: true,
  temWhatsapp: true,
  temInstagram: true,
  temEmail: false,
  temTelefone: true,
  temMetaPixel: false,
  temGtm: false,
  temGa4: false,
  viewportMobile: true,
  plataformaEcommerce: null,
  cnpjEncontrado: true,
});
ok(
  "site sem NENHUM rastreio aponta Meta e Google Ads como oportunidade",
  semRastreio.oportunidades.includes("meta_ads") && semRastreio.oportunidades.includes("google_ads"),
);
ok("score de quem tem site + canais é maior que quem não tem nada", semRastreio.score > semNada.score, `${semRastreio.score} > ${semNada.score}`);

const jaAnuncia = pontuarProspect({
  vertical: "delivery_hamburgueria",
  temWebsite: true,
  temWhatsapp: true,
  temInstagram: true,
  temEmail: true,
  temTelefone: true,
  temMetaPixel: true,
  temGtm: true,
  temGa4: true,
  viewportMobile: true,
  plataformaEcommerce: null,
  cnpjEncontrado: true,
});
ok(
  "quem já rastreia NÃO ganha oportunidade de meta_ads/google_ads",
  !jaAnuncia.oportunidades.includes("meta_ads") && !jaAnuncia.oportunidades.includes("google_ads"),
);

const ecommerceSemPixel = pontuarProspect({
  vertical: "ecommerce",
  temWebsite: true,
  temWhatsapp: false,
  temInstagram: true,
  temEmail: false,
  temTelefone: false,
  temMetaPixel: false,
  temGtm: false,
  temGa4: null,
  viewportMobile: true,
  plataformaEcommerce: "shopify",
  cnpjEncontrado: false,
});
ok("e-commerce sem pixel aponta remarketing", ecommerceSemPixel.oportunidades.includes("remarketing"));
ok("motivo cita a plataforma detectada", ecommerceSemPixel.motivos.some((m) => m.includes("shopify")));

secao("2. Nunca invade o que não foi observado");
ok(
  "nenhum resultado afirma porte/faturamento — fatoresAusentes sempre lista isso",
  semNada.fatoresAusentes.some((f) => f.includes("porte")),
);

/* ── 3. deduplicação ── */

secao("3. Deduplicação — nunca 4 vezes o mesmo negócio");

ok(
  "place_id vence tudo",
  chaveDeduplicacao({ placeId: "p1", cnpj: "123", negocio: "Pizza A" }) === "place:p1",
);
ok(
  "CNPJ ignora pontuação",
  chaveDeduplicacao({ cnpj: "12.345.678/0001-90", negocio: "X" }) ===
    chaveDeduplicacao({ cnpj: "12345678000190", negocio: "Y diferente" }),
);
ok(
  "domínio normaliza www e protocolo",
  chaveDeduplicacao({ website: "https://www.pizzaosasco.com.br/cardapio", negocio: "A" }) ===
    chaveDeduplicacao({ website: "pizzaosasco.com.br", negocio: "B" }),
);
ok(
  "telefone ignora formatação",
  chaveDeduplicacao({ telefone: "(11) 98888-7777", negocio: "A" }) ===
    chaveDeduplicacao({ telefone: "11988887777", negocio: "B diferente" }),
);
ok(
  "nomes realmente diferentes não colidem",
  chaveDeduplicacao({ negocio: "Pizzaria do Zé" }) !== chaveDeduplicacao({ negocio: "Hamburgueria da Ana" }),
);

/* ── 4/5. navegador real + persistência — via HTTP, porque navegador.ts e
   repositorio.ts são "server-only" e só rodam dentro do processo Next.
   Mesmo padrão de testes/contexto-e2e.mjs: prova contra o servidor de
   verdade, não contra um clone do módulo. ── */

const BASE = process.env.JARVIS_URL ?? "http://localhost:3000";
async function api(caminho, opcoes) {
  const r = await fetch(`${BASE}${caminho}`, opcoes);
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
}

secao("4. Persistência — criar, deduplicar, diagnosticar (via HTTP real)");

const NEGOCIO_TESTE = "___Teste Jarvis Pizzaria___";

const criado = await api("/api/prospeccao", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    acao: "criar",
    negocio: NEGOCIO_TESTE,
    vertical: "delivery_pizzaria",
    cidade: "Osasco",
    website: "https://example.com",
    fonte: "teste_automatizado",
  }),
});
ok("POST criar → 201", criado.status === 201, String(criado.status));
ok("prospect criado tem id", Boolean(criado.corpo.prospect?.id));
const prospectId = criado.corpo.prospect?.id;

const duplicado = await api("/api/prospeccao", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    acao: "criar",
    negocio: NEGOCIO_TESTE + " (nome levemente diferente)",
    vertical: "delivery_pizzaria",
    website: "https://www.example.com/",
    fonte: "teste_automatizado",
  }),
});
ok("mesmo domínio não duplica → 200, não 201", duplicado.status === 200, String(duplicado.status));
ok("é o mesmo id da primeira vez", duplicado.corpo.prospect?.id === prospectId);

secao("5. Navegador real (Playwright) — diagnóstico ponta-a-ponta");

const t0 = Date.now();
const diag = await api("/api/prospeccao", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ acao: "diagnosticar", id: prospectId }),
});
const duracao = Date.now() - t0;
ok("diagnosticar → 200", diag.status === 200, String(diag.status));
ok("visitou um site real e voltou sem erro", diag.corpo.sinais?.erro === null, diag.corpo.sinais?.erro ?? "");
ok("http status real capturado", diag.corpo.sinais?.httpStatus === 200, `${diag.corpo.sinais?.httpStatus}`);
ok(
  "título real da página capturado",
  diag.corpo.sinais?.tituloPagina === "Example Domain",
  diag.corpo.sinais?.tituloPagina ?? "",
);
ok(
  "tempo de carregamento medido de verdade",
  (diag.corpo.sinais?.tempoCarregamentoMs ?? 0) > 0,
  `${diag.corpo.sinais?.tempoCarregamentoMs}ms`,
);
ok("navegador real leva tempo de verdade (não instantâneo)", duracao > 200, `${duracao}ms`);
ok(
  "site sem pixel/gtm/ga4 reporta ausência honesta",
  !diag.corpo.sinais?.temMetaPixel && !diag.corpo.sinais?.temGtm && !diag.corpo.sinais?.temGa4,
);
ok("score foi gravado no prospect", typeof diag.corpo.prospect?.score === "number", `${diag.corpo.prospect?.score}`);
ok(
  "motivo do score foi gravado",
  typeof diag.corpo.prospect?.motivo_score === "string" && diag.corpo.prospect.motivo_score.length > 0,
);

const semSite = await api("/api/prospeccao", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    acao: "criar",
    negocio: "___Teste Jarvis Sem Site___",
    vertical: "delivery_pizzaria",
    fonte: "teste_automatizado",
  }),
});
const semSiteDiag = await api("/api/prospeccao", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ acao: "diagnosticar", id: semSite.corpo.prospect.id }),
});
ok("diagnosticar sem website → 400, não trava nem inventa", semSiteDiag.status === 400, String(semSiteDiag.status));

/* ── limpeza ── */

const dbTeste = new DatabaseSync("dados/jarvis.db");
dbTeste.exec("PRAGMA foreign_keys = ON");
dbTeste.prepare("DELETE FROM prospects WHERE negocio LIKE '___Teste Jarvis%'").run();
const sobrou = dbTeste.prepare("SELECT COUNT(*) n FROM prospects WHERE negocio LIKE '___Teste Jarvis%'").get().n;
dbTeste.close();
ok("prospect de teste removido", sobrou === 0);

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
