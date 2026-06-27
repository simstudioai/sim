import { HuggingFaceIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const HuggingFaceBlockDisplay = {
  type: 'huggingface',
  name: 'Hugging Face',
  description: 'Use Hugging Face Inference API',
  category: 'tools',
  bgColor: '#0B0F19',
  icon: HuggingFaceIcon,
  longDescription:
    'Integrate Hugging Face into the workflow. Can generate completions using the Hugging Face Inference API.',
  docsLink: 'https://docs.sim.ai/integrations/huggingface',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
