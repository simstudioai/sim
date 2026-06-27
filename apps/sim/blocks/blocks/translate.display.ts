import { TranslateIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const TranslateBlockDisplay = {
  type: 'translate',
  name: 'Translate',
  description: 'Translate text to any language',
  category: 'blocks',
  bgColor: '#FF4B4B',
  icon: TranslateIcon,
  longDescription: 'Integrate Translate into the workflow. Can translate text to any language.',
  docsLink: 'https://docs.sim.ai/integrations/translate',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
