import { sincronizarVaultGit, obsidianGitConfigurado } from "@/lib/obsidian/sync-git";

export const runtime = "nodejs";

/** Disparo manual da sincronização do vault (além do agendador automático a cada 30min). */
export async function POST() {
  if (!obsidianGitConfigurado()) {
    return Response.json({ ok: false, motivo: "OBSIDIAN_GIT_REMOTO não configurado" }, { status: 400 });
  }
  const resultado = await sincronizarVaultGit();
  return Response.json(resultado, { status: resultado.ok ? 200 : 500 });
}
