import { SendgridIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SendGridBlockDisplay = {
  type: 'sendgrid',
  name: 'SendGrid',
  description: 'Send emails and manage contacts, lists, and templates with SendGrid',
  category: 'tools',
  bgColor: '#1A82E2',
  icon: SendgridIcon,
  longDescription:
    'Integrate SendGrid into your workflow. Send transactional emails, manage marketing contacts and lists, and work with email templates. Supports dynamic templates, attachments, and comprehensive contact management.',
  docsLink: 'https://docs.sim.ai/integrations/sendgrid',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay
