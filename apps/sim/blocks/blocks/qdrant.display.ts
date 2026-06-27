import { QdrantIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const QdrantBlockDisplay = {
  type: 'qdrant',
  name: 'Qdrant',
  description: 'Use Qdrant vector database',
  category: 'tools',
  bgColor: '#1A223F',
  icon: QdrantIcon,
  longDescription: 'Integrate Qdrant into the workflow. Can upsert, search, and fetch points.',
  docsLink: 'https://qdrant.tech/documentation/',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
