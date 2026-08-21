"use client";

import type { ReactNode } from "react";

/**
 * Grid bento — 1 coluna até 1280px, 2 colunas a partir daí.
 *
 * O breakpoint acompanha a largura real da sidebar: ela é fixa (aside) só a
 * partir de 1024px, mas continua estreita (256px) até 1280px — 2 colunas
 * nessa faixa espremeria cada carta em ~120px, ilegível. A sidebar alarga
 * para 26rem em xl (ver JarvisComando.tsx), e é só aí que o grid abre a
 * segunda coluna. Na gaveta mobile (<1024px) o xl nunca dispara, então fica
 * em 1 coluna sem precisar de prop nem container query.
 */
export function JarvisBentoGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">{children}</div>;
}
