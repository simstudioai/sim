import { TwilioIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const TwilioVoiceBlockDisplay = {
  type: 'twilio_voice',
  name: 'Twilio Voice',
  description: 'Make and manage phone calls',
  category: 'tools',
  bgColor: '#F22F46',
  icon: TwilioIcon,
  iconColor: '#F22F46',
  longDescription:
    'Integrate Twilio Voice into the workflow. Make outbound calls and retrieve call recordings.',
  docsLink: 'https://docs.sim.ai/integrations/twilio_voice',
  integrationType: IntegrationType.Communication,
  triggerAllowed: true,
} satisfies BlockDisplay
