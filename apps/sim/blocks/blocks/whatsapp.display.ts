import { WhatsAppIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const WhatsAppBlockDisplay = {
  type: 'whatsapp',
  name: 'WhatsApp',
  description: 'Send WhatsApp messages',
  category: 'tools',
  bgColor: '#25D366',
  icon: WhatsAppIcon,
  iconColor: '#25D366',
  longDescription: 'Integrate WhatsApp into the workflow. Can send messages.',
  docsLink: 'https://docs.sim.ai/integrations/whatsapp',
  integrationType: IntegrationType.Communication,
  triggerAllowed: true,
} satisfies BlockDisplay
