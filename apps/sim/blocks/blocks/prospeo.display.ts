import { ProspeoIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ProspeoBlockDisplay = {
  type: 'prospeo',
  name: 'Prospeo',
  description: 'Enrich and search B2B contacts and companies',
  category: 'tools',
  bgColor: '#FF1A26',
  icon: ProspeoIcon,
  longDescription:
    'Find verified work emails and mobile numbers, enrich person and company profiles, and search a B2B database of leads and companies using 20+ filters.',
  docsLink: 'https://docs.sim.ai/integrations/prospeo',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
