import { ConvexIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ConvexBlockDisplay = {
  type: 'convex',
  name: 'Convex',
  description: 'Use Convex database',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ConvexIcon,
  longDescription:
    'Integrate Convex into the workflow. Run query, mutation, and action functions on your deployment, list tables with their schemas, and export documents with snapshot pagination and change deltas.',
  docsLink: 'https://docs.sim.ai/integrations/convex',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
