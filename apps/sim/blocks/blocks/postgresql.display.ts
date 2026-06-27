import { PostgresIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const PostgreSQLBlockDisplay = {
  type: 'postgresql',
  name: 'PostgreSQL',
  description: 'Connect to PostgreSQL database',
  category: 'tools',
  bgColor: '#336791',
  icon: PostgresIcon,
  longDescription:
    'Integrate PostgreSQL into the workflow. Can query, insert, update, delete, and execute raw SQL.',
  docsLink: 'https://docs.sim.ai/integrations/postgresql',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
