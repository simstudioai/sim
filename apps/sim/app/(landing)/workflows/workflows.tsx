import {
  PlatformHeroVisual,
  SolutionsPage,
  type SolutionsPageConfig,
} from '@/app/(landing)/components'
import {
  AuditTrailGraphic,
  BuildMethodsGraphic,
  DeployGraphic,
  RunMonitoringGraphic,
} from '@/app/(landing)/enterprise/components/feature-graphics'
import { KnowledgeAnswerGraphic } from '@/app/(landing)/solutions/components/feature-graphics'
import {
  AgentCodeGraphic,
  WorkflowCanvasGraphic,
} from '@/app/(landing)/workflows/components/feature-graphics'
import { WorkflowsEditorLoop } from '@/app/(landing)/workflows/components/workflows-editor-loop'

/**
 * Workflows platform page - a consumer of {@link SolutionsPage} rendered
 * with the enterprise page's feature-tile treatment.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside
 * the shared route-group layout chrome: identity (for structured data), a
 * hero, and card rows of 3-4 cards. Every visual slot carries a feature
 * graphic in the enterprise design language - the build-methods loop and
 * deploy window reused for the stories they already tell, the monitoring
 * panel, chat answer, and audit ledger retold for scheduled runs, Slack
 * bots, and run tracing (as a 2×2 grid, so each vignette keeps its full
 * treatment), plus two workflows-specific vignettes: the mini builder
 * canvas and its code-side twin.
 *
 * The JSON-LD emitted by {@link SolutionsPage} is structurally identical
 * to the platform page's (`WebPage` + `BreadcrumbList` +
 * `WebApplication`), so the switch to feature tiles is SEO-neutral.
 */
const WORKFLOWS_CONFIG: SolutionsPageConfig = {
  module: 'Workflows',
  path: '/workflows',
  hero: {
    eyebrow: 'Workflows',
    heading: 'Build Slack bots, compliance agents, and data pipelines in Sim.',
    description:
      'Connect blocks, every major LLM, and 1,000+ integrations into agent logic, the visual builder in Sim, the open-source AI workspace. Build visually, conversationally, or with code.',
    summary:
      'Workflows is the visual builder in Sim, the open-source AI workspace where teams build, deploy, and manage AI agents. Wire blocks, every major LLM, and 1,000+ integrations into agent logic, then deploy and run it without leaving Sim, visually, conversationally, or with code.',
    visual: (
      <PlatformHeroVisual>
        <WorkflowsEditorLoop />
      </PlatformHeroVisual>
    ),
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
          visual: <WorkflowCanvasGraphic />,
        },
        {
          title: 'Describe it in words',
          description:
            'Tell Sim what the agent should do in plain language, and the workspace assembles the workflow for you.',
          visual: <BuildMethodsGraphic />,
        },
        {
          title: 'Drop into code',
          description:
            'Reach for code blocks when you need exact control. Sim runs your logic alongside every other block.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: <AgentCodeGraphic />,
        },
      ],
    },
    {
      id: 'deploy',
      title: 'Deploy and run without leaving Sim.',
      subtitle:
        'Ship agents to production as APIs, Slack bots, or scheduled jobs, and trace every run block by block, all in one workspace.',
      cta: { label: 'Learn about deployment', href: '/signup' },
      columns: 2,
      cards: [
        {
          title: 'Ship as an API',
          description:
            'Sim exposes every workflow as an endpoint, so any system can call your agent with one request.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: (
            <DeployGraphic
              url='sim.ai/api/agents/support'
              statusLabel='Endpoint live in production'
            />
          ),
        },
        {
          title: 'Run on a schedule',
          description:
            'Set agents to run on a cadence. Sim handles the triggers so the work happens on its own.',
          visual: <RunMonitoringGraphic />,
        },
        {
          title: 'Connect to Slack',
          description:
            'Turn a workflow into a Slack bot your team talks to. Sim wires the integration end to end.',
          visual: (
            <KnowledgeAnswerGraphic
              question='@sim how do refunds work for annual plans?'
              answer='Annual plans are refunded pro-rata — the refund workflow checks the policy, computes the credit, and files it in Zendesk automatically.'
              sourceLabel='Support playbook'
              sourceDetail='Answered in #support'
            />
          ),
        },
        {
          title: 'Trace every run',
          description:
            'Sim logs each run block by block, so teams see exactly what an agent did and why.',
          visual: (
            <AuditTrailGraphic
              entries={[
                {
                  action: 'Run completed',
                  actor: 'Support agent',
                  resource: '24 tickets resolved',
                  time: 'Now',
                  avatar: '/landing/team-avatar-1.jpg',
                },
                {
                  action: 'Reply sent',
                  actor: 'Support agent',
                  resource: '#support',
                  time: '2 min ago',
                  avatar: '/landing/team-avatar-2.jpg',
                },
                {
                  action: 'Tool called',
                  actor: 'Support agent',
                  resource: 'Zendesk API',
                  time: '2 min ago',
                  avatar: '/landing/team-avatar-3.jpg',
                },
                {
                  action: 'Run started',
                  actor: 'Schedule trigger',
                  resource: 'Daily at 9:00',
                  time: '3 min ago',
                  avatar: '/landing/team-avatar-1.jpg',
                },
              ]}
            />
          ),
        },
      ],
    },
  ],
}

export default function Workflows() {
  return <SolutionsPage config={WORKFLOWS_CONFIG} cardVariant='featureTile' />
}
