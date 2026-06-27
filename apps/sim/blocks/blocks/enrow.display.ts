import { EnrowIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const EnrowBlockDisplay = {
  type: 'enrow',
  name: 'Enrow',
  description: 'Find and verify B2B emails with triple-verified accuracy',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: EnrowIcon,
  longDescription:
    'Integrate Enrow to find verified B2B email addresses from a full name and company, or verify the deliverability of an existing email. Enrow performs deterministic verifications including catch-all emails — no additional verifier needed.',
  docsLink: 'https://enrow.readme.io',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const EnrowBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://enrow.io',
} as const satisfies BlockMeta
