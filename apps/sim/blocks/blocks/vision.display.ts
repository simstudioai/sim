import { EyeIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const VisionBlockDisplay = {
  type: 'vision',
  name: 'Vision (Legacy)',
  description: 'Analyze images with vision models',
  category: 'blocks',
  bgColor: '#4D5FFF',
  icon: EyeIcon,
  longDescription: 'Integrate Vision into the workflow. Can analyze images with vision models.',
  docsLink: 'https://docs.sim.ai/integrations/vision',
  integrationType: IntegrationType.AI,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const VisionV2BlockDisplay = {
  ...VisionBlockDisplay,
  type: 'vision_v2',
  name: 'Vision',
  description: 'Analyze images with vision models',
  hideFromToolbar: true,
} satisfies BlockDisplay
