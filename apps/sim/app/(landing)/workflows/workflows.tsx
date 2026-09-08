import {
  SolutionsPage,
  type SolutionsProductPageConfig,
} from '@/app/(landing)/components/solutions-page'
import { ProductHeroPreview } from '@/app/(landing)/components/solutions-page/components/solutions-product-page/components/product-hero-preview'
import { WorkflowBuilderPreview } from '@/app/(landing)/workflows/components/workflow-builder-preview'
import { WorkflowDeploymentPreview } from '@/app/(landing)/workflows/components/workflow-deployment-preview'
import { WorkflowSchedulePreview } from '@/app/(landing)/workflows/components/workflow-schedule-preview'

/** Shared description for page metadata and structured data. */
export const WORKFLOWS_PAGE_DESCRIPTION =
  'Build AI workflows in Sim with visual blocks, models, and integrations. Run on a schedule or event, then deploy as an API, chat, or MCP tool.'

const WORKFLOWS_CONFIG: SolutionsProductPageConfig = {
  module: 'Workflows',
  path: '/workflows',
  seoDescription: WORKFLOWS_PAGE_DESCRIPTION,
  hero: {
    eyebrow: 'Workflows',
    heading: 'Build AI workflows you can follow.',
    description: 'Connect models, tools, and data. Build, test, and deploy AI workflows in Sim.',
    summary:
      'Sim Workflows is the visual builder in the open-source AI workspace. Teams connect models, integrations, code, and workspace data into reusable AI workflows. Start runs manually, on a schedule, or from an event, then deploy a version as an API, a chat, or an MCP tool.',
    visual: <ProductHeroPreview product='workflows' />,
  },
  codeExample: {
    title: 'Deploy and run from your terminal.',
    description:
      'Use the Sim CLI to deploy a workflow you’ve built, run it, and follow its progress from your terminal.',
    filename: 'workflows.sh',
    commands: [
      'sim workflows list',
      'sim workflows deploy \\',
      '  "$WORKFLOW_ID"',
      'sim workflows run \\',
      '  "$WORKFLOW_ID" --follow',
    ],
  },
  features: [
    {
      id: 'build',
      label: 'Visual builder',
      title: 'Build visually. Run with confidence.',
      description: 'Connect models, tools, and logic in a canvas you can inspect and test.',
      visual: <WorkflowBuilderPreview />,
      visualSize: 'compact',
      cta: { label: 'Explore the builder', href: 'https://docs.sim.ai/workflows' },
    },
    {
      id: 'triggers',
      label: 'Triggers',
      title: 'Start with an event.',
      description: 'Run on a schedule, from a webhook, or when connected tools have new work.',
      visual: <WorkflowSchedulePreview />,
      cta: { label: 'Explore triggers', href: 'https://docs.sim.ai/workflows/triggers/schedule' },
    },
    {
      id: 'deploy',
      label: 'Deployment',
      title: 'From canvas to live workflow.',
      description: 'Publish as an API, chat, or MCP tool, with versions you can return to.',
      visual: <WorkflowDeploymentPreview />,
      cta: { label: 'Explore deployment', href: 'https://docs.sim.ai/workflows/deployment' },
    },
  ],
}

export default function Workflows() {
  return <SolutionsPage config={WORKFLOWS_CONFIG} />
}
