import { PackageSearchIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const KnowledgeBlockDisplay = {
  type: 'knowledge',
  name: 'Knowledge',
  description: 'Use vector search',
  category: 'blocks',
  bgColor: '#00B0B0',
  icon: PackageSearchIcon,
  longDescription:
    'Integrate Knowledge into the workflow. Perform full CRUD operations on documents, chunks, and tags.',
  docsLink: 'https://docs.sim.ai/integrations/knowledge',
} satisfies BlockDisplay
