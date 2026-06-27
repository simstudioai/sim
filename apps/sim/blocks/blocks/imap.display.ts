import { MailServerIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ImapBlockDisplay = {
  type: 'imap',
  name: 'IMAP Email',
  description: 'Trigger workflows when new emails arrive via IMAP (works with any email provider)',
  category: 'triggers',
  bgColor: '#6366F1',
  icon: MailServerIcon,
  longDescription:
    'Connect to any email server via IMAP protocol to trigger workflows when new emails are received. Supports Gmail, Outlook, Yahoo, and any other IMAP-compatible email provider.',
  docsLink: 'https://docs.sim.ai/integrations/imap',
  integrationType: IntegrationType.Email,
  hideFromToolbar: false,
  triggerAllowed: true,
} satisfies BlockDisplay
