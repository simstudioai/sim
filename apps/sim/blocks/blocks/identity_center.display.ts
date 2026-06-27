import { IdentityCenterIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const IdentityCenterBlockDisplay = {
  type: 'identity_center',
  name: 'AWS Identity Center',
  description: 'Manage temporary elevated access in AWS IAM Identity Center',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: IdentityCenterIcon,
  longDescription:
    'Provision and revoke temporary access to AWS accounts via IAM Identity Center (SSO). Assign permission sets to users or groups, look up users by email, and list accounts and permission sets for access request workflows.',
  docsLink: 'https://docs.sim.ai/integrations/identity_center',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
