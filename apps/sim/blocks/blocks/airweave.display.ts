import { AirweaveIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AirweaveBlockDisplay = {
  type: 'airweave',
  name: 'Airweave',
  description: 'Search your synced data collections',
  category: 'tools',
  bgColor: '#6366F1',
  icon: AirweaveIcon,
  iconColor: '#6366F1',
  longDescription:
    'Search across your synced data sources using Airweave. Supports semantic search with hybrid, neural, or keyword retrieval strategies. Optionally generate AI-powered answers from search results.',
  docsLink: 'https://docs.sim.ai/integrations/airweave',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
