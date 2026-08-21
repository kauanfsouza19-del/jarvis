/**
 * Loader ESM só para os testes: resolve import relativo sem extensão
 * tentando ".ts" antes de desistir. O código da aplicação usa import
 * extensionless de propósito (é o padrão aceito pelo bundler do Next) — mas
 * o `node` puro que os testes usam exige extensão explícita em ESM. Este
 * loader existe só para não forçar mudança de estilo no código real por
 * causa de uma limitação do executor de teste.
 *
 * Uso: node --import ./testes/lib/resolver-ts.mjs testes/arquivo.mjs
 */
import { register } from "node:module";

register(new URL("./hook-ts.mjs", import.meta.url).href, import.meta.url);
