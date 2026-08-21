/**
 * Hook de resolução ESM (Node module customization API) usado só pelos
 * testes: quando um import relativo sem extensão falha, tenta de novo com
 * ".ts" antes de desistir. Resolve a cadeia inteira — se A importa B sem
 * extensão e B importa C sem extensão, os dois passam por aqui.
 *
 * Não é carregado pela aplicação — só por `node --import
 * testes/lib/resolver-ts.mjs`. O código de produção continua usando import
 * extensionless, que é o padrão correto para o bundler do Next.
 */

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (erro) {
    const semExtensao = specifier.startsWith(".") && !/\.[a-zA-Z0-9]+$/.test(specifier);
    if (!semExtensao) throw erro;
    return nextResolve(`${specifier}.ts`, context);
  }
}
