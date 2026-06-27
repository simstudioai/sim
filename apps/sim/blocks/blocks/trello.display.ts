import { TrelloIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const TrelloBlockDisplay = {
  type: 'trello',
  name: 'Trello',
  description: 'Manage Trello lists, cards, and activity',
  category: 'tools',
  bgColor: '#0052CC',
  icon: TrelloIcon,
  longDescription:
    'Integrate with Trello to list board lists, list cards, create cards, update cards, review activity, and add comments.',
  docsLink: 'https://docs.sim.ai/integrations/trello',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay
