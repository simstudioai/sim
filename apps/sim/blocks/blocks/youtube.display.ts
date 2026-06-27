import { YouTubeIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const YouTubeBlockDisplay = {
  type: 'youtube',
  name: 'YouTube',
  description: 'Interact with YouTube videos, channels, and playlists',
  category: 'tools',
  bgColor: '#FF0000',
  icon: YouTubeIcon,
  longDescription:
    'Integrate YouTube into the workflow. Can search for videos, get trending videos, get video details, get video categories, get channel information, get all videos from a channel, get channel playlists, get playlist items, and get video comments.',
  docsLink: 'https://docs.sim.ai/integrations/youtube',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay
