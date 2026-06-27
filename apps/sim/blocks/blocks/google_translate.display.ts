import { GoogleTranslateIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleTranslateBlockDisplay = {
  type: 'google_translate',
  name: 'Google Translate',
  description: 'Translate text using Google Cloud Translation',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleTranslateIcon,
  longDescription:
    'Translate and detect languages using the Google Cloud Translation API. Supports auto-detection of the source language.',
  docsLink: 'https://docs.sim.ai/integrations/google_translate',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
