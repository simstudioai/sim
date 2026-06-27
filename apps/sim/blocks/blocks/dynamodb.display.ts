import { DynamoDBIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const DynamoDBBlockDisplay = {
  type: 'dynamodb',
  name: 'Amazon DynamoDB',
  description: 'Get, put, query, scan, update, and delete items in Amazon DynamoDB tables',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #2E27AD 0%, #527FFF 100%)',
  icon: DynamoDBIcon,
  iconColor: '#527FFF',
  longDescription:
    'Integrate Amazon DynamoDB into workflows. Supports Get, Put, Query, Scan, Update, Delete, and Introspect operations on DynamoDB tables.',
  docsLink: 'https://docs.sim.ai/integrations/dynamodb',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
