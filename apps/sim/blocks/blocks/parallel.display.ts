import { ParallelIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ParallelBlockDisplay = {
  type: 'parallel_ai',
  name: 'Parallel AI',
  description: 'Web research with Parallel AI',
  category: 'tools',
  bgColor: '#1D1C1A',
  icon: ParallelIcon,
  longDescription:
    'Integrate Parallel AI into the workflow. Can search the web, extract information from URLs, and conduct deep research.',
  docsLink: 'https://docs.sim.ai/integrations/parallel_ai',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
