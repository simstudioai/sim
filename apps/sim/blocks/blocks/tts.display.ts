import { TTSIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const TtsBlockDisplay = {
  type: 'tts',
  name: 'Text-to-Speech',
  description: 'Convert text to speech using AI voices',
  category: 'blocks',
  bgColor: '#181C1E',
  icon: TTSIcon,
  longDescription:
    'Generate natural-sounding speech from text using state-of-the-art AI voices from OpenAI, Deepgram, ElevenLabs, Cartesia, Google Cloud, Azure, and PlayHT. Supports multiple voices, languages, and audio formats.',
  docsLink: 'https://docs.sim.ai/integrations/tts',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
