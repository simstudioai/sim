import { TwilioIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const TwilioSMSBlockDisplay = {
  type: 'twilio_sms',
  name: 'Twilio SMS',
  description: 'Send SMS messages',
  category: 'tools',
  bgColor: '#F22F46',
  icon: TwilioIcon,
  iconColor: '#F22F46',
  longDescription: 'Integrate Twilio into the workflow. Can send SMS messages.',
  docsLink: 'https://docs.sim.ai/integrations/twilio_sms',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay
