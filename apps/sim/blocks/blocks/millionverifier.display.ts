import { MillionVerifierIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const MillionVerifierBlockDisplay = {
  type: 'millionverifier',
  name: 'MillionVerifier',
  description: 'Verify email deliverability and check account credits',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MillionVerifierIcon,
  longDescription:
    'Integrate MillionVerifier to verify email deliverability in real time — classify addresses as valid, invalid, catch-all, disposable, or unknown — and check your remaining verification credits.',
  docsLink: 'https://docs.sim.ai/integrations/millionverifier',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const MillionVerifierBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://www.millionverifier.com',
} as const satisfies BlockMeta
