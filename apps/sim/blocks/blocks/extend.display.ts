import { ExtendIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ExtendBlockDisplay = {
  type: 'extend',
  name: 'Extend',
  description: 'Parse and extract content from documents',
  category: 'tools',
  bgColor: '#000000',
  icon: ExtendIcon,
  longDescription:
    'Integrate Extend AI into the workflow. Parse and extract structured content from documents including PDFs, images, and Office files.',
  docsLink: 'https://docs.sim.ai/integrations/extend',
  integrationType: IntegrationType.AI,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const ExtendV2BlockDisplay = {
  ...ExtendBlockDisplay,
  type: 'extend_v2',
  name: 'Extend',
  longDescription:
    'Integrate Extend AI into the workflow. Parse and extract structured content from documents or file references.',
  hideFromToolbar: false,
} satisfies BlockDisplay
