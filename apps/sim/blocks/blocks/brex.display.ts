import { BrexIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const BrexBlockDisplay = {
  type: 'brex',
  name: 'Brex',
  description: 'Manage expenses, receipts, transactions, and team data in Brex',
  category: 'tools',
  bgColor: '#171717',
  icon: BrexIcon,
  longDescription:
    'Integrates Brex into the workflow. List and update expenses, upload and match receipts, view card and cash transactions, accounts, budgets, spend limits, vendors, transfers, and team data.',
  docsLink: 'https://docs.sim.ai/integrations/brex',
  integrationType: IntegrationType.Commerce,
} satisfies BlockDisplay
