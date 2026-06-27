import { AttioIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AttioBlockDisplay = {
  type: 'attio',
  name: 'Attio',
  description: 'Manage records, notes, tasks, lists, comments, and more in Attio CRM',
  category: 'tools',
  bgColor: '#1D1E20',
  icon: AttioIcon,
  longDescription:
    'Connect to Attio to manage CRM records (people, companies, custom objects), notes, tasks, lists, list entries, comments, workspace members, and webhooks.',
  docsLink: 'https://docs.sim.ai/integrations/attio',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
