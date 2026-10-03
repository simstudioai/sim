import {
  SolutionsPage,
  type SolutionsProductPageConfig,
} from '@/app/(landing)/components/solutions-page'
import { ProductHeroPreview } from '@/app/(landing)/components/solutions-page/components/solutions-product-page/components/product-hero-preview'
import { LogHistoryPreview } from '@/app/(landing)/logs/components/log-history-preview'
import { LogSnapshotPreview } from '@/app/(landing)/logs/components/log-snapshot-preview'
import { LogTracePreview } from '@/app/(landing)/logs/components/log-trace-preview'

/** Shared description for page metadata and structured data. */
export const LOGS_PAGE_DESCRIPTION =
  'Inspect AI workflow runs in Sim. Filter run history, trace block inputs and outputs, and open the workflow snapshot behind each execution.'

const LOGS_CONFIG: SolutionsProductPageConfig = {
  module: 'Logs',
  path: '/logs',
  seoDescription: LOGS_PAGE_DESCRIPTION,
  hero: {
    visual: <ProductHeroPreview product='logs' />,
    eyebrow: 'Logs',
    heading: 'A clear view of every agent run.',
    description:
      'Follow every execution, inspect the details, and understand what happened in Sim.',
    summary:
      'Sim Logs brings AI workflow run history and debugging into the open-source AI workspace. Teams filter runs by workflow, status, trigger, and time, inspect block inputs and outputs, compare duration and credits, and view the saved workflow snapshot behind an execution.',
  },
  features: [
    {
      id: 'history',
      label: 'Run history',
      title: 'From history to the full picture.',
      description: 'Filter your runs and open an execution to see its timing, status, and steps.',
      visual: <LogHistoryPreview />,
      cta: { label: 'Explore run history', href: 'https://docs.sim.ai/logs-debugging/logging' },
    },
    {
      id: 'trace',
      label: 'Execution traces',
      title: 'Every step, in view.',
      description:
        'Inspect inputs, outputs, model responses, and tool calls in an execution trace.',
      visual: <LogTracePreview />,
      cta: { label: 'Explore traces', href: 'https://docs.sim.ai/logs-debugging/logging' },
    },
    {
      id: 'snapshot',
      label: 'Workflow snapshots',
      title: 'Go back to what actually ran.',
      description:
        'Open the saved workflow snapshot to inspect the original blocks and configuration.',
      visual: <LogSnapshotPreview />,
      cta: { label: 'Explore debugging', href: 'https://docs.sim.ai/logs-debugging/logging' },
    },
  ],
}

export default function Logs() {
  return <SolutionsPage config={LOGS_CONFIG} />
}
