import type { NextConfig } from "next";

const cabecalhosDeSeguranca = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
  // Só faz sentido quando servido por HTTPS de verdade (Fase 15 —
  // produção) — em dev local (http://localhost) o navegador ignora este
  // header de qualquer forma, mas não custa restringir a produção mesmo
  // assim (nunca manda HSTS prometendo HTTPS que ainda não existe).
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" }] : []),
];

const config: NextConfig = {
  // Fase 15 — achado real de segurança, NÃO usar `output: "standalone"`
  // neste projeto: testado (build local + inspeção da saída) e confirmado
  // que o tracer copia `dados/` inteiro — banco SQLite real com prospect
  // de verdade e todo export CSV/XLSX gerado — pra dentro do artefato de
  // build. `outputFileTracingExcludes` não teve efeito nenhum nesta versão
  // (Next 16.3/Turbopack) — tentado e descartado, não é omissão. A saída
  // padrão (`next build` + `next start`, o que `package.json` já usa)
  // nunca faz essa cópia de árvore, então nunca tem essa classe de vazamento
  // — Docker usa o mesmo caminho (ver Dockerfile), só com
  // `npm prune --omit=dev` depois do build pra imagem menor.
  async headers() {
    return [{ source: "/:caminho*", headers: cabecalhosDeSeguranca }];
  },
  // Fase 16 — não anuncia a versão/stack no header X-Powered-By (informação
  // de reconhecimento gratuita pra quem for varrer a instância pública).
  poweredByHeader: false,
};

export default config;
