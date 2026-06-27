import { SpotifyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SpotifyBlockDisplay = {
  type: 'spotify',
  name: 'Spotify',
  description: 'Search music, manage playlists, control playback, and access your library',
  category: 'tools',
  bgColor: '#000000',
  icon: SpotifyIcon,
  longDescription:
    'Integrate Spotify into your workflow. Search for tracks, albums, artists, and playlists. Manage playlists, access your library, control playback, browse podcasts and audiobooks.',
  docsLink: 'https://docs.sim.ai/integrations/spotify',
  integrationType: IntegrationType.Communication,
  hideFromToolbar: true,
} satisfies BlockDisplay
