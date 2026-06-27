import { STTIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SttBlockDisplay = {
  type: 'stt',
  name: 'Speech-to-Text',
  description: 'Convert speech to text using AI',
  category: 'blocks',
  bgColor: '#181C1E',
  icon: STTIcon,
  longDescription:
    'Transcribe audio and video files to text using leading AI providers. Supports multiple languages, timestamps, and speaker diarization.',
  docsLink: 'https://docs.sim.ai/integrations/stt',
  integrationType: IntegrationType.AI,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const SttV2BlockDisplay = {
  ...SttBlockDisplay,
  type: 'stt_v2',
  name: 'Speech-to-Text',
  hideFromToolbar: false,
} satisfies BlockDisplay
