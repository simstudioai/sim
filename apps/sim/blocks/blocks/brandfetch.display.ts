import { BrandfetchIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const BrandfetchBlockDisplay = {
  type: 'brandfetch',
  name: 'Brandfetch',
  description: 'Look up brand assets, logos, colors, and company info',
  category: 'tools',
  bgColor: '#000000',
  icon: BrandfetchIcon,
  longDescription:
    'Integrate Brandfetch into your workflow. Retrieve brand logos, colors, fonts, and company data by domain, ticker, or name search.',
  docsLink: 'https://docs.sim.ai/integrations/brandfetch',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
