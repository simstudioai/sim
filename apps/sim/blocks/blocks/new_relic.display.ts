import { NewRelicIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const NewRelicBlockDisplay = {
  type: 'new_relic',
  name: 'New Relic',
  description: 'Query observability data and record deployments in New Relic',
  category: 'tools',
  bgColor: '#000000',
  icon: NewRelicIcon,
  longDescription:
    'Integrate New Relic into workflows. Run NRQL queries, search monitored entities, fetch entity details, and record deployment change events.',
  docsLink: 'https://docs.sim.ai/integrations/new_relic',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay
