import { SerperIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SerperBlockDisplay = {
  type: 'serper',
  name: 'Serper',
  description: 'Search the web using Serper',
  category: 'tools',
  bgColor: '#2B3543',
  icon: SerperIcon,
  longDescription: 'Integrate Serper into the workflow. Can search the web.',
  docsLink: 'https://docs.sim.ai/integrations/serper',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
