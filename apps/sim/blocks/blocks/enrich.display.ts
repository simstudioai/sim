import { EnrichSoIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const EnrichBlockDisplay = {
  type: 'enrich',
  name: 'Enrich',
  description: 'B2B data enrichment and LinkedIn intelligence with Enrich.so',
  category: 'tools',
  bgColor: '#E5E5E6',
  icon: EnrichSoIcon,
  longDescription:
    'Access real-time B2B data intelligence with Enrich.so. Enrich profiles from email addresses, find work emails from LinkedIn, verify email deliverability, search for people and companies, and analyze LinkedIn post engagement.',
  docsLink: 'https://docs.enrich.so/',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
