import { EnrichmentIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const EnrichmentBlockDisplay = {
  type: 'enrichment',
  name: 'Data Enrichment',
  description: 'Enrich data with a Sim enrichment',
  category: 'blocks',
  bgColor: '#9333EA',
  icon: EnrichmentIcon,
  longDescription:
    'Run a Sim enrichment to look up data — work email, phone number, company domain, company info, and more — from the fields you map in. Uses the same provider cascade as table enrichments.',
  docsLink: 'https://docs.sim.ai/integrations/enrichment',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
