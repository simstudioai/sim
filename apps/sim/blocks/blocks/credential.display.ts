import { CredentialIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const CredentialBlockDisplay = {
  type: 'credential',
  name: 'Credential',
  description: 'Select or list OAuth credentials',
  category: 'blocks',
  bgColor: '#6366F1',
  icon: CredentialIcon,
  longDescription:
    'Select an OAuth credential once and pipe its ID into any downstream block that requires authentication, or list all OAuth credentials in the workspace for iteration. No secrets are ever exposed — only credential IDs and metadata.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/credential',
} satisfies BlockDisplay
