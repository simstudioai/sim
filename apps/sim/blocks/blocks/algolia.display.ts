import { AlgoliaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AlgoliaBlockDisplay = {
  type: 'algolia',
  name: 'Algolia',
  description: 'Search and manage Algolia indices',
  category: 'tools',
  bgColor: '#003DFF',
  icon: AlgoliaIcon,
  iconColor: '#003DFF',
  longDescription:
    'Integrate Algolia into your workflow. Search indices, manage records (add, update, delete, browse), configure index settings, and perform batch operations.',
  docsLink: 'https://docs.sim.ai/integrations/algolia',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
