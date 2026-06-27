import { EmailBisonIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const EmailBisonBlockDisplay = {
  type: 'emailbison',
  name: 'Email Bison',
  description: 'Manage Email Bison leads, campaigns, replies, and tags',
  category: 'tools',
  bgColor: '#FB7A22',
  icon: EmailBisonIcon,
  iconColor: '#FB7A22',
  longDescription:
    'Integrate Email Bison into workflows. Create and update leads, manage campaigns, attach leads to campaigns, list replies, and organize leads with tags.',
  docsLink: 'https://docs.sim.ai/integrations/emailbison',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay
