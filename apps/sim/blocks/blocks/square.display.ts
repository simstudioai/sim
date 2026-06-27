import { SquareIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SquareBlockDisplay = {
  type: 'square',
  name: 'Square',
  description: 'Process payments and manage Square commerce data',
  category: 'tools',
  bgColor: '#000000',
  icon: SquareIcon,
  longDescription:
    'Integrate Square into the workflow. Take and refund payments, manage customers, build catalog items and images, create and search orders, and issue invoices. Authenticate with a Square access token (personal access token).',
  docsLink: 'https://docs.sim.ai/integrations/square',
  integrationType: IntegrationType.Commerce,
} satisfies BlockDisplay
