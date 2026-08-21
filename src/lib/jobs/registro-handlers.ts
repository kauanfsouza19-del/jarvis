import "server-only";

/**
 * Ponto único de registro — importar este módulo (por efeito colateral)
 * garante que todo handler de job está no despachante antes de qualquer
 * `criarJob` ou `recuperarJobsOrfaos` rodar.
 *
 * Adicionar um tipo de job novo é criar o arquivo em `handlers/` e
 * importá-lo aqui — nunca editar `motor.ts`.
 */
import "./handlers/prospeccao";
import "./handlers/executar-ferramenta";
import "./handlers/plano-orquestrado";
import "./handlers/inteligencia";
