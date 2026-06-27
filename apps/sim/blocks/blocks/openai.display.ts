import { OpenAIIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const OpenAIBlockDisplay = {
  type: 'openai',
  name: 'Embeddings',
  description: 'Generate Open AI embeddings',
  category: 'tools',
  bgColor: '#000000',
  icon: OpenAIIcon,
  longDescription: 'Integrate Embeddings into the workflow. Can generate embeddings from text.',
  docsLink: 'https://docs.sim.ai/integrations/openai',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
