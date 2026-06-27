import { AzureIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const MicrosoftAdBlockDisplay = {
  type: 'microsoft_ad',
  name: 'Azure AD',
  description: 'Manage users and groups in Azure AD (Microsoft Entra ID)',
  category: 'tools',
  bgColor: '#0078D4',
  icon: AzureIcon,
  longDescription:
    'Integrate Azure Active Directory into your workflows. List, create, update, and delete users and groups. Manage group memberships programmatically.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_ad',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
