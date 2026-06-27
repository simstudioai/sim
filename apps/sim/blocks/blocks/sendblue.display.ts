import { SendblueIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SendblueBlockDisplay = {
  type: 'sendblue',
  name: 'Sendblue',
  description: 'Send and receive iMessage and SMS',
  category: 'tools',
  bgColor: '#008BFF',
  icon: SendblueIcon,
  longDescription:
    'Send iMessages and SMS to individuals or groups, check whether a number supports iMessage, show typing indicators, and look up message status with Sendblue. Trigger workflows on inbound messages and delivery status updates.',
  docsLink: 'https://docs.sim.ai/integrations/sendblue',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay
