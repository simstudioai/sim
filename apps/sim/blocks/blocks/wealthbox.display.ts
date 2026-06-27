import { WealthboxIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const WealthboxBlockDisplay = {
  type: 'wealthbox',
  name: 'Wealthbox',
  description: 'Interact with Wealthbox',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: WealthboxIcon,
  longDescription:
    'Integrate Wealthbox into the workflow. Can read and write notes, read and write contacts, and read and write tasks.',
  docsLink: 'https://docs.sim.ai/integrations/wealthbox',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
