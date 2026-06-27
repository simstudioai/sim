import { LinkupIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const LinkupBlockDisplay = {
  type: 'linkup',
  name: 'Linkup',
  description: 'Search the web with Linkup',
  category: 'tools',
  bgColor: '#D6D3C7',
  icon: LinkupIcon,
  longDescription: 'Integrate Linkup into the workflow. Can search the web.',
  docsLink: 'https://docs.sim.ai/integrations/linkup',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
