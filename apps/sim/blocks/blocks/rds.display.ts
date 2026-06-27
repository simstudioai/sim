import { RDSIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const RDSBlockDisplay = {
  type: 'rds',
  name: 'Amazon RDS',
  description: 'Connect to Amazon RDS via Data API',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #2E27AD 0%, #527FFF 100%)',
  icon: RDSIcon,
  iconColor: '#527FFF',
  longDescription:
    'Integrate Amazon RDS Aurora Serverless into the workflow using the Data API. Can query, insert, update, delete, and execute raw SQL without managing database connections.',
  docsLink: 'https://docs.sim.ai/integrations/rds',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
