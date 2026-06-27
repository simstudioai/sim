import { LangsmithIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const LangsmithBlockDisplay = {
  type: 'langsmith',
  name: 'LangSmith',
  description: 'Forward workflow runs to LangSmith for observability',
  category: 'tools',
  bgColor: '#181C1E',
  icon: LangsmithIcon,
  longDescription:
    'Send run data to LangSmith to trace executions, attach metadata, and monitor workflow performance.',
  docsLink: 'https://docs.sim.ai/integrations/langsmith',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay
