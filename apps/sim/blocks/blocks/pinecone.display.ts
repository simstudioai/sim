import { PineconeIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const PineconeBlockDisplay = {
  type: 'pinecone',
  name: 'Pinecone',
  description: 'Use Pinecone vector database',
  category: 'tools',
  bgColor: '#0D1117',
  icon: PineconeIcon,
  longDescription:
    'Integrate Pinecone into the workflow. Can generate embeddings, upsert text, search with text, fetch vectors, and search with vectors.',
  docsLink: 'https://docs.sim.ai/integrations/pinecone',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
