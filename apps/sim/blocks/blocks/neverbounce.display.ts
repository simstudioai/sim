import { NeverBounceIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const NeverBounceBlockDisplay = {
  type: 'neverbounce',
  name: 'NeverBounce',
  description: 'Verify email deliverability and check account credits',
  category: 'tools',
  bgColor: '#064AF4',
  icon: NeverBounceIcon,
  longDescription:
    'Integrate NeverBounce to verify email deliverability in real time — classify addresses as valid, invalid, catch-all, disposable, or unknown — and check your remaining verification credits.',
  docsLink: 'https://docs.sim.ai/integrations/neverbounce',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const NeverBounceBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://www.neverbounce.com',
} as const satisfies BlockMeta
