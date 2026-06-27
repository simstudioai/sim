import { RB2BIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const RB2BBlockDisplay = {
  type: 'rb2b',
  name: 'RB2B',
  description: 'Identify and enrich website visitors',
  category: 'tools',
  bgColor: '#51FF00',
  icon: RB2BIcon,
  longDescription:
    'Resolve IP addresses, hashed emails, and LinkedIn profiles into person-level identity and B2B enrichment data using the RB2B API. Convert IPs to hashed emails, MAIDs, and company domains; enrich emails into LinkedIn profiles, business profiles, and mobile IDs; and look up emails or phone numbers from LinkedIn. Requires an RB2B API key.',
  docsLink: 'https://docs.sim.ai/integrations/rb2b',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
