import { HunterIOIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const HunterBlockDisplay = {
  type: 'hunter',
  name: 'Hunter.io',
  description: 'Find and verify professional email addresses',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: HunterIOIcon,
  longDescription:
    'Integrate Hunter into the workflow. Can search domains, find email addresses, verify email addresses, discover companies, find companies, and count email addresses.',
  docsLink: 'https://docs.sim.ai/integrations/hunter',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
