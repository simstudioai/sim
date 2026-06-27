import { ProfoundIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ProfoundBlockDisplay = {
  type: 'profound',
  name: 'Profound',
  description: 'AI visibility and analytics with Profound',
  category: 'tools',
  bgColor: '#000000',
  icon: ProfoundIcon,
  longDescription:
    'Track how your brand appears across AI platforms. Monitor visibility scores, sentiment, citations, bot traffic, referrals, content optimization, and prompt volumes with Profound.',
  docsLink: 'https://docs.sim.ai/integrations/profound',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay
