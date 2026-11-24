import { INTEGRATION_COUNT_LABEL } from '@sim/deployment-config/integration-claims'

/**
 * Category questions answer engines ask before they name a product: what Sim is, who can
 * build with it, how it is hosted, deployed, and governed. Every answer restates a claim the
 * homepage already makes (`HOME_FEATURES`, the security certifications), and the FAQPage
 * JSON-LD reads this same array, so the structured answers always equal the visible ones.
 * Pricing questions live on `/pricing`; do not repeat them here.
 */
export const HOME_FAQS = [
  {
    question: 'Is Sim an AI agent builder?',
    answer: `Yes. Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Build an agent visually in the workflow builder, describe it in Chat and let Sim build it, or write it with code through the API and CLI, using ${INTEGRATION_COUNT_LABEL} integrations and every major LLM.`,
  },
  {
    question: 'Can non-technical teams build AI agents in Sim?',
    answer:
      'Yes. In Chat, anyone can describe the agent they need in plain language and Sim builds it. The visual workflow builder shows every step, so teams can review and adjust an agent without writing code, and engineers can extend it with custom functions, the API, or the CLI.',
  },
  {
    question: 'Is Sim open source, and can I self-host it?',
    answer:
      'Yes. Sim is open source under the Apache 2.0 license. Run it in your own cloud with Docker or Kubernetes, or use the hosted workspace at sim.ai.',
  },
  {
    question: 'How do teams deploy agents built in Sim?',
    answer:
      'Deploy an agent as a chat, an API endpoint, or an MCP server, the standard way other AI tools call an agent. A chat can be public or limited to SSO, specific emails, or a password. Agents can also run on a schedule or start from event triggers in connected apps.',
  },
  {
    question: 'How does Sim govern AI agents across a company?',
    answer:
      'Administrators use permission groups to control which models, integrations, and tools each team can use, and set organization and per-member spend limits. Sim keeps audit records and run tracing, supports single sign-on with domain verification and configurable data retention, and is SOC 2 Type II compliant.',
  },
] as const
