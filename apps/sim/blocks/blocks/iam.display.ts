import { IAMIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const IAMBlockDisplay = {
  type: 'iam',
  name: 'AWS IAM',
  description: 'Manage AWS IAM users, roles, policies, and groups',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: IAMIcon,
  longDescription:
    'Integrate AWS Identity and Access Management into your workflow. Create and manage users, roles, policies, groups, and access keys.',
  docsLink: 'https://docs.sim.ai/integrations/iam',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
