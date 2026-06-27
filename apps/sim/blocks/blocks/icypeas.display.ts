import { IcypeasIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const IcypeasBlockDisplay = {
  type: 'icypeas',
  name: 'Icypeas',
  description: 'Find and verify professional email addresses',
  category: 'tools',
  bgColor: '#d4d4d4',
  icon: IcypeasIcon,
  longDescription:
    'Integrate Icypeas to find a professional email address from a name and company domain, or verify whether an existing email is valid and deliverable. Results are returned asynchronously via polling.',
  docsLink: 'https://docs.sim.ai/tools/icypeas',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const IcypeasBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://www.icypeas.com',
} as const satisfies BlockMeta
