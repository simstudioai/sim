import { ClickHouseIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ClickHouseBlockDisplay = {
  type: 'clickhouse',
  name: 'ClickHouse',
  description: 'Connect to a ClickHouse database',
  category: 'tools',
  bgColor: '#f9ff69',
  icon: ClickHouseIcon,
  longDescription:
    'Integrate ClickHouse into the workflow. Query and insert data, manage databases and tables, inspect schemas, monitor mutations and running queries, manage partitions, and execute raw SQL over the ClickHouse HTTP interface.',
  docsLink: 'https://docs.sim.ai/integrations/clickhouse',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
