/**
 * Proteção contra força bruta no login (Fase 15) — função pura, sem
 * "server-only": mesmo padrão de decidirAutorizacao(), testável direto sem
 * subir servidor. Estado em memória (Map por IP) — proporcional a um
 * processo único e persistente (a Fase 14 já estabeleceu que o Jarvis roda
 * como servidor sempre-ligado, não serverless; reiniciar limpa o contador,
 * o que é aceitável — não é uma trava de segurança de longo prazo, é
 * fricção contra tentativa automatizada).
 */

const JANELA_MS = 15 * 60 * 1000; // 15 minutos
const MAX_TENTATIVAS = 5;

type Registro = { falhas: number[]; bloqueadoAte: number | null };
const tentativasPorIp = new Map<string, Registro>();

function limpar(agora: number) {
  for (const [ip, reg] of tentativasPorIp) {
    const semFalhaRecente = reg.falhas.every((t) => agora - t > JANELA_MS);
    const semBloqueio = !reg.bloqueadoAte || reg.bloqueadoAte < agora;
    if (semFalhaRecente && semBloqueio) tentativasPorIp.delete(ip);
  }
}

export function estaBloqueado(ip: string, agora = Date.now()): { bloqueado: true; ateMs: number } | { bloqueado: false } {
  const reg = tentativasPorIp.get(ip);
  if (reg?.bloqueadoAte && reg.bloqueadoAte > agora) return { bloqueado: true, ateMs: reg.bloqueadoAte };
  return { bloqueado: false };
}

/** Chamar em toda tentativa de login que falhou — 5 falhas em 15min bloqueia por 15min. */
export function registrarFalha(ip: string, agora = Date.now()): void {
  limpar(agora);
  const reg = tentativasPorIp.get(ip) ?? { falhas: [], bloqueadoAte: null };
  reg.falhas = reg.falhas.filter((t) => agora - t <= JANELA_MS);
  reg.falhas.push(agora);
  if (reg.falhas.length >= MAX_TENTATIVAS) {
    reg.bloqueadoAte = agora + JANELA_MS;
    reg.falhas = [];
  }
  tentativasPorIp.set(ip, reg);
}

/** Chamar em todo login bem-sucedido — reseta o contador do IP (não deixa uma falha antiga contar depois de logar certo). */
export function registrarSucesso(ip: string): void {
  tentativasPorIp.delete(ip);
}

/** Só para teste — nunca chamado em produção. */
export function _resetarParaTeste(): void {
  tentativasPorIp.clear();
}
