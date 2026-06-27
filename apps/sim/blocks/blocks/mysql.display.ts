import { MySQLIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const MySQLBlockDisplay = {
  type: 'mysql',
  name: 'MySQL',
  description: 'Connect to MySQL database',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MySQLIcon,
  longDescription:
    'Integrate MySQL into the workflow. Can query, insert, update, delete, and execute raw SQL.',
  docsLink: 'https://docs.sim.ai/integrations/mysql',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
