import { RedditIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const RedditBlockDisplay = {
  type: 'reddit',
  name: 'Reddit',
  description: 'Access Reddit data and content',
  category: 'tools',
  bgColor: '#FF5700',
  icon: RedditIcon,
  iconColor: '#FF5700',
  longDescription:
    'Integrate Reddit into workflows. Read posts, comments, and search content. Submit posts, vote, reply, edit, manage messages, and access user and subreddit info.',
  docsLink: 'https://docs.sim.ai/integrations/reddit',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay
