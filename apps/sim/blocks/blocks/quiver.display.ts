import { QuiverIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const QuiverBlockDisplay = {
  type: 'quiver',
  name: 'Quiver',
  description: 'Generate and vectorize SVGs',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: QuiverIcon,
  longDescription:
    'Generate SVG images from text prompts or vectorize raster images into SVGs using QuiverAI. Supports reference images, style instructions, and multiple output generation.',
  docsLink: 'https://docs.sim.ai/integrations/quiver',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
