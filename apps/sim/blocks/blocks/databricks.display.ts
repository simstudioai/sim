import { DatabricksIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const DatabricksBlockDisplay = {
  type: 'databricks',
  name: 'Databricks',
  description: 'Run SQL queries and manage jobs on Databricks',
  category: 'tools',
  bgColor: '#F9F7F4',
  icon: DatabricksIcon,
  longDescription:
    'Connect to Databricks to execute SQL queries against SQL warehouses, trigger and monitor job runs, manage clusters, and retrieve run outputs. Requires a Personal Access Token and workspace host URL.',
  docsLink: 'https://docs.sim.ai/integrations/databricks',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
