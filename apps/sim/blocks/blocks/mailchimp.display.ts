import { MailchimpIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const MailchimpBlockDisplay = {
  type: 'mailchimp',
  name: 'Mailchimp',
  description: 'Manage audiences, campaigns, and marketing automation in Mailchimp',
  category: 'tools',
  bgColor: '#FFE01B',
  icon: MailchimpIcon,
  longDescription:
    'Integrate Mailchimp into the workflow. Can manage audiences (lists), list members, campaigns, automation workflows, templates, reports, segments, tags, merge fields, interest categories, landing pages, signup forms, and batch operations.',
  docsLink: 'https://docs.sim.ai/integrations/mailchimp',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay
