import { SixtyfourIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SixtyfourBlockDisplay = {
  type: 'sixtyfour',
  name: 'Sixtyfour AI',
  description: 'Enrich leads and companies with AI-powered research',
  category: 'tools',
  bgColor: '#000000',
  icon: SixtyfourIcon,
  longDescription:
    'Find emails, phone numbers, and enrich lead or company data with contact information, social profiles, and detailed research using Sixtyfour AI.',
  docsLink: 'https://docs.sim.ai/integrations/sixtyfour',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
