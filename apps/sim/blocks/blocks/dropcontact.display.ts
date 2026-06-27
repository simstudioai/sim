import { DropcontactIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const DropcontactBlockDisplay = {
  type: 'dropcontact',
  name: 'Dropcontact',
  description: 'Enrich B2B contacts with verified email, phone, and company data',
  category: 'tools',
  bgColor: '#0066FF',
  icon: DropcontactIcon,
  longDescription:
    'Use Dropcontact to verify and enrich B2B contacts. Submit a contact with their name, company, website, or LinkedIn URL and receive a verified professional email, phone number, company firmographics, and LinkedIn profile. Enrichment is async: Dropcontact processes the request, then Sim polls until the result is ready. Credits are only charged when a verified email is returned.',
  docsLink: 'https://docs.sim.ai/tools/dropcontact',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const DropcontactBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://www.dropcontact.com',
} as const satisfies BlockMeta
