/** Foundation first; the final layer encloses the complete stack. */
export const STACK_LAYERS = [
  {
    id: 'governance',
    title: 'Governance',
    headline: 'Control starts at the foundation.',
    description:
      'Set permissions, manage your organization, and decide who can access every workspace, agent, and resource.',
    detail: 'Permissions · Workspaces · Organization',
  },
  {
    id: 'data',
    title: 'Data & Context',
    headline: 'Give every agent the full picture.',
    description:
      'Connect your integrations, knowledge bases, files, and tables. Sim Search brings the right context into every task.',
    detail: 'Sim Search · Integrations · Knowledge · Files · Tables',
  },
  {
    id: 'models',
    title: 'Models',
    headline: 'The right intelligence for every task.',
    description:
      'Work with leading models in one workspace. Choose the model that fits each step, with control over access and spend.',
    detail: 'Model choice · Shared access · Usage controls',
  },
  {
    id: 'agents',
    title: 'Agents & Workflows',
    headline: 'Turn context into action.',
    description:
      'Build agents through chat, a visual canvas, or code. Connect models, tools, and data into workflows your team can run.',
    detail: 'Chat · Canvas · Code',
  },
  {
    id: 'observability',
    title: 'Observability',
    headline: 'See what happens at every step.',
    description:
      'Trace agent runs, inspect inputs and outputs, and understand performance, failures, and spend.',
    detail: 'Run traces · Logs · Performance · Spend',
  },
  {
    id: 'sim',
    title: 'Sim',
    headline: 'One workspace. The entire stack.',
    description:
      'One shared home for your agents, data, models, and controls. Everything your team needs to put AI to work.',
    detail: 'Your complete AI workspace',
  },
] as const
