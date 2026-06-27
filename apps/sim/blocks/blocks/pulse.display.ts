import { PulseIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const PulseBlockDisplay = {
  type: 'pulse',
  name: 'Pulse',
  description: 'Extract text from documents using Pulse OCR',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: PulseIcon,
  longDescription:
    'Integrate Pulse into the workflow. Extract text from PDF documents, images, and Office files via URL or upload.',
  docsLink: 'https://docs.sim.ai/integrations/pulse',
  integrationType: IntegrationType.AI,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const PulseV2BlockDisplay = {
  ...PulseBlockDisplay,
  type: 'pulse_v2',
  name: 'Pulse',
  longDescription:
    'Integrate Pulse into the workflow. Extract text from PDF documents, images, and Office files via upload or file references.',
  hideFromToolbar: false,
} satisfies BlockDisplay
