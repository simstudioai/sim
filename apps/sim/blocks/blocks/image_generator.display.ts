import { ImageIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ImageGeneratorBlockDisplay = {
  type: 'image_generator',
  name: 'Image Generator',
  description: 'Generate images',
  category: 'blocks',
  bgColor: '#4D5FFF',
  icon: ImageIcon,
  longDescription:
    'Integrate Image Generator into the workflow. Can generate images using DALL-E 3 and GPT Image models.',
  docsLink: 'https://docs.sim.ai/integrations/image_generator',
  integrationType: IntegrationType.AI,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const ImageGeneratorV2BlockDisplay = {
  type: 'image_generator_v2',
  name: 'Image Generator',
  description: 'Generate images',
  category: 'blocks',
  bgColor: '#4D5FFF',
  icon: ImageIcon,
  longDescription:
    'Generate images using OpenAI GPT Image, Google Nano Banana, or Fal.ai image models.',
  docsLink: 'https://docs.sim.ai/integrations/image_generator',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
