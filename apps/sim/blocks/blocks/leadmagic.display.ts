import { LeadMagicIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const LeadMagicBlockDisplay = {
  type: 'leadmagic',
  name: 'LeadMagic',
  description: 'Find and enrich B2B contacts, emails, mobile numbers, and company data',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: LeadMagicIcon,
  longDescription:
    'Integrate LeadMagic to find verified work emails by name or company, validate email deliverability, find direct mobile numbers, enrich LinkedIn profiles, reverse-lookup profiles from emails, search companies by domain, identify role holders at accounts, and check account credit balance.',
  docsLink: 'https://docs.sim.ai/tools/leadmagic',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
