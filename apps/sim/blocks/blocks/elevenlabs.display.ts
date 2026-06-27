import { ElevenLabsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ElevenLabsBlockDisplay = {
  type: 'elevenlabs',
  name: 'ElevenLabs',
  description: 'Convert text to speech with ElevenLabs',
  category: 'tools',
  bgColor: '#181C1E',
  icon: ElevenLabsIcon,
  longDescription: 'Integrate ElevenLabs into the workflow. Can convert text to speech.',
  docsLink: 'https://docs.sim.ai/integrations/elevenlabs',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
