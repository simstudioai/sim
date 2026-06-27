import { DatagmaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const DatagmaBlockDisplay = {
  type: 'datagma',
  name: 'Datagma',
  description: 'Find verified B2B emails, mobile phones, and enrich person or company profiles',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: DatagmaIcon,
  longDescription:
    'Integrate Datagma to find verified work emails from a name and company, enrich person profiles via email or LinkedIn URL, enrich company data from a domain or name, look up mobile phone numbers from LinkedIn, and check your credit balance.',
  docsLink: 'https://docs.sim.ai/tools/datagma',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
