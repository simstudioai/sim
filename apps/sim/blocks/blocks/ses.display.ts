import { SESIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SESBlockDisplay = {
  type: 'ses',
  name: 'AWS SES',
  description: 'Send emails and manage templates with AWS Simple Email Service',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: SESIcon,
  longDescription:
    'Integrate AWS SES v2 into the workflow. Send simple, templated, and bulk emails. Manage email templates and retrieve account sending quota and verified identity information.',
  docsLink: 'https://docs.sim.ai/integrations/ses',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay
