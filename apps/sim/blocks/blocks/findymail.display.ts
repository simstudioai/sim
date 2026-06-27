import { FindymailIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const FindymailBlockDisplay = {
  type: 'findymail',
  name: 'Findymail',
  description: 'Find and verify B2B emails, phones, employees, and company data',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: FindymailIcon,
  longDescription:
    'Integrate Findymail to find verified work emails by name, domain, or LinkedIn URL, verify deliverability, reverse-lookup profiles from emails, enrich company data, find employees by job title, look up phone numbers, search technology stacks, and check credit usage.',
  docsLink: 'https://docs.sim.ai/integrations/findymail',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
