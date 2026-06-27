import { xIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const XBlockDisplay = {
  type: 'x',
  name: 'X',
  description: 'Interact with X',
  category: 'tools',
  bgColor: '#000000',
  icon: xIcon,
  longDescription:
    'Integrate X into the workflow. Search tweets, manage bookmarks, follow/block/mute users, like and retweet, view trends, and more.',
  docsLink: 'https://docs.sim.ai/integrations/x',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay
