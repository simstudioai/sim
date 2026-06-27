import { MailgunIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const MailgunBlockDisplay = {
  type: 'mailgun',
  name: 'Mailgun',
  description: 'Send emails and manage mailing lists with Mailgun',
  category: 'tools',
  bgColor: '#C12126',
  icon: MailgunIcon,
  longDescription:
    'Integrate Mailgun into your workflow. Send transactional emails, manage mailing lists and members, view domain information, and track email events. Supports text and HTML emails, tags for tracking, and comprehensive list management.',
  docsLink: 'https://docs.sim.ai/integrations/mailgun',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay
