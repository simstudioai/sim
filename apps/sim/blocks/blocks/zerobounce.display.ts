import { ZeroBounceIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ZeroBounceBlockDisplay = {
  type: 'zerobounce',
  name: 'ZeroBounce',
  description: 'Validate email deliverability and check account credits',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ZeroBounceIcon,
  longDescription:
    'Integrate ZeroBounce to validate email deliverability in real time — detect invalid, catch-all, spamtrap, abuse, and do-not-mail addresses — and check your remaining validation credits.',
  docsLink: 'https://docs.sim.ai/integrations/zerobounce',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const ZeroBounceBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://www.zerobounce.net',
} as const satisfies BlockMeta
