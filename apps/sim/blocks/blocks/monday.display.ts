import { MondayIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const MondayBlockDisplay = {
  type: 'monday',
  name: 'Monday',
  description: 'Manage Monday.com boards, items, and groups',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MondayIcon,
  longDescription:
    'Integrate with Monday.com to list boards, get board details, fetch and search items, create and update items, archive or delete items, create subitems, move items between groups, add updates, and create groups.',
  docsLink: 'https://docs.sim.ai/integrations/monday',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay
