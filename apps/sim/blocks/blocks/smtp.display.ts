import { SmtpIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SmtpBlockDisplay = {
  type: 'smtp',
  name: 'SMTP',
  description: 'Send emails via any SMTP mail server',
  category: 'tools',
  bgColor: '#2D3748',
  icon: SmtpIcon,
  longDescription:
    'Send emails using any SMTP server (Gmail, Outlook, custom servers, etc.). Configure SMTP connection settings and send emails with full control over content, recipients, and attachments.',
  docsLink: 'https://docs.sim.ai/integrations/smtp',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay
