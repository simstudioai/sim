import { ClerkIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ClerkBlockDisplay = {
  type: 'clerk',
  name: 'Clerk',
  description: 'Manage users, organizations, and sessions in Clerk',
  category: 'tools',
  bgColor: '#131316',
  icon: ClerkIcon,
  longDescription:
    'Integrate Clerk authentication and user management into your workflow. Create, update, delete, and list users. Manage organizations and their memberships. Monitor and control user sessions.',
  docsLink: 'https://docs.sim.ai/integrations/clerk',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
