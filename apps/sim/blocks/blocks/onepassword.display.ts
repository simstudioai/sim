import { OnePasswordIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const OnePasswordBlockDisplay = {
  type: 'onepassword',
  name: '1Password',
  description: 'Manage secrets and items in 1Password vaults',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: OnePasswordIcon,
  longDescription:
    'Access and manage secrets stored in 1Password vaults using the Connect API or Service Account SDK. List vaults, retrieve items with their fields and secrets, create new items, update existing ones, delete items, and resolve secret references.',
  docsLink: 'https://docs.sim.ai/integrations/onepassword',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
