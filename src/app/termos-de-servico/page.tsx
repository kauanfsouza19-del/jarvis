export const metadata = { title: "Termos de Serviço — Jarvis" };

/** Pública de propósito (Fase 22) — mesmo motivo da política de privacidade. */
export default function TermosDeServico() {
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
      <h1 style={{ fontSize: 26, marginBottom: 8 }}>Termos de Serviço</h1>
      <p style={{ color: "var(--color-tinta-fraca)", fontSize: 13, marginBottom: 32 }}>Última atualização: 25 de agosto de 2026.</p>

      <p>
        O Jarvis é um sistema pessoal de uso individual, operado por{" "}
        <strong>[NOME DO RESPONSÁVEL — preencher]</strong>. Não é oferecido como produto público a terceiros; estes
        termos existem para atender requisitos de plataformas integradas (ex: verificação OAuth do Google) e deixar
        claro o funcionamento do sistema.
      </p>

      <h2 style={S.h2}>Natureza do sistema</h2>
      <p>
        O Jarvis é um assistente operacional com acesso a ferramentas reais (leitura/inspeção de código, execução
        de testes, pesquisa, memória, integrações). Toda ação de risco — publicar, enviar mensagem externa, alterar
        orçamento, gravar código — exige aprovação explícita do operador antes de ser executada; nada acontece
        silenciosamente.
      </p>

      <h2 style={S.h2}>Limitações</h2>
      <ul style={S.ul}>
        <li>O sistema é um assistente de apoio à decisão — nunca substitui julgamento humano em decisões financeiras, legais ou de segurança.</li>
        <li>Respostas dependem de modelos de IA de terceiros (Anthropic, Google) e podem conter erros; nenhuma saída deve ser tratada como fato garantido sem verificação.</li>
        <li>Disponibilidade não é garantida — é um sistema pessoal, sem SLA.</li>
      </ul>

      <h2 style={S.h2}>Uso aceitável</h2>
      <p>
        O acesso é restrito ao operador autorizado por token/sessão. Não há suporte a múltiplos usuários nem a uso
        por terceiros sem autorização explícita do responsável.
      </p>

      <h2 style={S.h2}>Contato</h2>
      <p>
        Dúvidas sobre estes termos: <strong>[E-MAIL DE CONTATO — preencher]</strong>.
      </p>
    </main>
  );
}

const S = {
  h2: { fontSize: 17, marginTop: 32, marginBottom: 8, color: "var(--color-tinta)" } as const,
  ul: { paddingLeft: 20, display: "flex", flexDirection: "column" as const, gap: 6, margin: "8px 0" },
};
