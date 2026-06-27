import { MongoDBIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const MongoDBBlockDisplay = {
  type: 'mongodb',
  name: 'MongoDB',
  description: 'Connect to MongoDB database',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MongoDBIcon,
  longDescription:
    'Integrate MongoDB into the workflow. Can find, insert, update, delete, and aggregate data.',
  docsLink: 'https://docs.sim.ai/integrations/mongodb',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
