import { AmplitudeIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AmplitudeBlockDisplay = {
  type: 'amplitude',
  name: 'Amplitude',
  description: 'Track events and query analytics from Amplitude',
  category: 'tools',
  bgColor: '#1B1F3B',
  icon: AmplitudeIcon,
  iconColor: '#1F77E0',
  longDescription:
    'Integrate Amplitude into your workflow to track events, identify users and groups, search for users, query analytics, and retrieve revenue data.',
  docsLink: 'https://docs.sim.ai/integrations/amplitude',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay
