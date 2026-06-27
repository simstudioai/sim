import { OktaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const OktaBlockDisplay = {
  type: 'okta',
  name: 'Okta',
  description: 'Manage users and groups in Okta',
  category: 'tools',
  bgColor: '#191919',
  icon: OktaIcon,
  iconColor: '#007DC1',
  longDescription:
    'Integrate Okta identity management into your workflow. List, create, update, activate, suspend, and delete users. Reset passwords. Manage groups and group membership.',
  docsLink: 'https://docs.sim.ai/integrations/okta',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
