import { TinybirdIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const TinybirdBlockDisplay = {
  type: 'tinybird',
  name: 'Tinybird',
  description: 'Send events, query data, and manage Data Sources with Tinybird',
  category: 'tools',
  bgColor: '#2EF598',
  icon: TinybirdIcon,
  longDescription:
    'Interact with Tinybird: stream JSON or NDJSON events with the Events API, run SQL with the Query API, call published Pipe API Endpoints by name with dynamic parameters, and manage Data Sources by appending from a URL, truncating, or deleting rows by condition.',
  docsLink: 'https://docs.sim.ai/integrations/tinybird',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay
