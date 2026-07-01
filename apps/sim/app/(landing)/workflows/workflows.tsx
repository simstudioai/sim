import { PlatformPage, type PlatformPageConfig } from '@/app/(landing)/components'

/**
 * Workflows platform page - the reference consumer of {@link PlatformPage}.
 *
 * The whole page is one typed {@link PlatformPageConfig} rendered inside the
 * shared route-group layout chrome: identity (for structured data), a hero, and
 * card rows of 3-4 cards. Every spacing, gutter, and section rhythm lives inside
 * the components - this page passes only content, so it cannot mis-space anything.
 *
 * Visual slots are `null` here, so each one renders the layout's reserved
 * `--surface-2` placeholder panel; a real page swaps in its own client visual
 * island (a product mock or animation) without touching the layout.
 */
const WORKFLOWS_CONFIG: PlatformPageConfig = {
  module: 'Workflows',
  path: '/workflows',
  hero: {
    heading: 'Build Slack bots, compliance agents, and data pipelines in Sim.',
    description:
      'Connect blocks, every major LLM, and 1,000+ integrations into agent logic, the visual builder in Sim, the open-source AI workspace. Build visually, conversationally, or with code.',
    summary:
      'Workflows is the visual builder in Sim, the open-source AI workspace where teams build, deploy, and manage AI agents. Wire blocks, every major LLM, and 1,000+ integrations into agent logic, then deploy and run it without leaving Sim, visually, conversationally, or with code.',
    visual: null,
  },
  rows: [
    {
      id: 'build',
      title: 'Build agents the way that fits.',
      subtitle:
        'Sim lets teams build agents visually, in natural language, or with code, wiring up any model and 1,000+ integrations in one workspace.',
      cta: { label: 'Explore the workflow builder', href: '/signup' },
      cards: [
        {
          title: 'Drag and connect',
          description:
            'Wire blocks, models, and integrations on the visual builder. Sim turns the graph into agent logic you can run.',
          visual: null,
        },
        {
          title: 'Describe it in words',
          description:
            'Tell Sim what the agent should do in plain language, and the workspace assembles the workflow for you.',
          visual: null,
        },
        {
          title: 'Drop into code',
          description:
            'Reach for code blocks when you need exact control. Sim runs your logic alongside every other block.',
          visual: null,
        },
      ],
    },
    {
      id: 'deploy',
      title: 'Deploy and run without leaving Sim.',
      subtitle:
        'Ship agents to production as APIs, Slack bots, or scheduled jobs, and trace every run block by block, all in one workspace.',
      cta: { label: 'Learn about deployment', href: '/signup' },
      cards: [
        {
          title: 'Ship as an API',
          description:
            'Sim exposes every workflow as an endpoint, so any system can call your agent with one request.',
          visual: null,
        },
        {
          title: 'Run on a schedule',
          description:
            'Set agents to run on a cadence. Sim handles the triggers so the work happens on its own.',
          visual: null,
        },
        {
          title: 'Connect to Slack',
          description:
            'Turn a workflow into a Slack bot your team talks to. Sim wires the integration end to end.',
          visual: null,
        },
        {
          title: 'Trace every run',
          description:
            'Sim logs each run block by block, so teams see exactly what an agent did and why.',
          visual: null,
        },
      ],
    },
  ],
}

export default function Workflows() {
  return <PlatformPage config={WORKFLOWS_CONFIG} />
}
