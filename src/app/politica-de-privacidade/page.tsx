export const metadata = { title: "Política de Privacidade — Jarvis" };

/**
 * Pública de propósito (Fase 22) — Google exige acesso sem login pra
 * revisão de OAuth. Descreve só o que o Jarvis realmente faz, verificado
 * no próprio código nesta fase — nunca capacidade aspiracional.
 */
export default function PoliticaDePrivacidade() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "48px 20px 80px",
        color: "var(--color-tinta)",
        lineHeight: 1.7,
        fontSize: 15,
      }}
    >
      <p className="mono" style={{ color: "var(--reator)", letterSpacing: "0.2em", fontSize: 11, marginBottom: 8 }}>
        JARVIS
      </p>
      <h1 style={{ fontSize: 26, marginBottom: 8 }}>Política de Privacidade</h1>
      <p style={{ color: "var(--color-tinta-fraca)", fontSize: 13, marginBottom: 32 }}>Última atualização: 25 de agosto de 2026.</p>

      <p>
        O Jarvis é um sistema operacional pessoal — de uso individual, não um produto comercial com múltiplos
        usuários. Esta política descreve como os dados são tratados na instância operada em{" "}
        <code>iajarvis.online</code>.
      </p>

      <h2 style={S.h2}>Quem opera este sistema</h2>
      <p>
        Responsável: <strong>[NOME DO RESPONSÁVEL — preencher]</strong>. Contato:{" "}
        <strong>[E-MAIL DE CONTATO — preencher]</strong>.
      </p>

      <h2 style={S.h2}>Dados armazenados</h2>
      <p>O Jarvis mantém, em banco de dados próprio (SQLite, hospedado no servidor do operador, sem compartilhamento com terceiros além dos descritos abaixo):</p>
      <ul style={S.ul}>
        <li>Histórico de conversas com o assistente e resultados de tarefas executadas.</li>
        <li>Memórias e conhecimento indexado a partir de projetos/documentos do próprio operador.</li>
        <li>Metadados operacionais: jobs, aprovações, notificações, registros de auditoria.</li>
        <li>Se conectado explicitamente pelo operador: tokens de acesso a Gmail/Google Calendar (OAuth do Google) e a um vault Obsidian via Git.</li>
      </ul>

      <h2 style={S.h2}>Autenticação</h2>
      <p>
        Acesso é protegido por um token único e por sessão via cookie <code>HttpOnly</code>, nunca acessível por
        JavaScript no navegador. Não existe cadastro de usuário nem coleta de dado de visitante — só o operador
        autenticado usa o sistema.
      </p>

      <h2 style={S.h2}>Serviços de terceiros usados</h2>
      <ul style={S.ul}>
        <li><strong>Anthropic (Claude)</strong> e, quando configurado, <strong>Google (Gemini)</strong> — processam o texto das conversas para gerar respostas. Sujeitos às respectivas políticas de privacidade desses provedores.</li>
        <li><strong>Google OAuth (Gmail/Calendar)</strong> — só quando o operador conecta explicitamente; usado exclusivamente para ler/gerenciar a própria conta do operador, nunca de terceiros.</li>
        <li><strong>GitHub</strong> — sincronização do vault de conhecimento pessoal (Obsidian), repositório privado.</li>
      </ul>

      <h2 style={S.h2}>O que o Jarvis nunca faz</h2>
      <ul style={S.ul}>
        <li>Não vende, aluga ou compartilha dados com terceiros para publicidade.</li>
        <li>Não expõe API keys, senhas ou credenciais em nenhuma resposta, log ou página.</li>
        <li>Não executa ação externa irreversível (enviar mensagem, publicar, mover dinheiro) sem aprovação explícita do operador.</li>
      </ul>

      <h2 style={S.h2}>Retenção e exclusão</h2>
      <p>
        Dados ficam armazenados enquanto o sistema estiver em operação. O operador pode solicitar exclusão de
        qualquer dado armazenado entrando em contato pelo e-mail acima.
      </p>

      <h2 style={S.h2}>Alterações</h2>
      <p>Esta política pode ser atualizada; a data no topo desta página reflete a versão vigente.</p>
    </main>
  );
}

const S = {
  h2: { fontSize: 17, marginTop: 32, marginBottom: 8, color: "var(--color-tinta)" } as const,
  ul: { paddingLeft: 20, display: "flex", flexDirection: "column" as const, gap: 6, margin: "8px 0" },
};
