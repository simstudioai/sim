import { OutlookIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const OutlookBlockDisplay = {
  type: 'outlook',
  name: 'Outlook',
  description: 'Send, read, draft, forward, and move Outlook email messages',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: OutlookIcon,
  longDescription:
    'Integrate Outlook into the workflow. Can read, draft, send, forward, and move email messages. Can be used in trigger mode to trigger a workflow when a new email is received.',
  docsLink: 'https://docs.sim.ai/integrations/outlook',
  integrationType: IntegrationType.Email,
  triggerAllowed: true,
} satisfies BlockDisplay
