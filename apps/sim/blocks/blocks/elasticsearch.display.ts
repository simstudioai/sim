import { ElasticsearchIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ElasticsearchBlockDisplay = {
  type: 'elasticsearch',
  name: 'Elasticsearch',
  description: 'Search, index, and manage data in Elasticsearch',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ElasticsearchIcon,
  longDescription:
    'Integrate Elasticsearch into workflows for powerful search, indexing, and data management. Supports document CRUD operations, advanced search queries, bulk operations, index management, and cluster monitoring. Works with both self-hosted and Elastic Cloud deployments.',
  docsLink: 'https://docs.sim.ai/integrations/elasticsearch',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
