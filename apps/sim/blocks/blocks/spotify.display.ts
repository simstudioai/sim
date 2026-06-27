import { SpotifyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

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

export const SpotifyBlockMeta = {
  tags: ['content-management', 'automation'],
  url: 'https://www.spotify.com',
  templates: [
    {
      icon: SpotifyIcon,
      title: 'Spotify weekly playlist builder',
      prompt:
        'Build a scheduled weekly workflow that searches Spotify for new releases in the genres a team follows, creates a fresh playlist, and adds the top tracks so there is always a curated Friday playlist ready.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['content', 'automation'],
    },
    {
      icon: SpotifyIcon,
      title: 'Spotify request bot',
      prompt:
        'Create a workflow triggered by a Slack message that takes a song request, searches Spotify for the best match, and adds the track to a shared office playlist, replying in the thread with what was added.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['content', 'communication', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SpotifyIcon,
      title: 'Spotify event soundtrack generator',
      prompt:
        'Build a workflow that takes an event theme, searches Spotify for fitting tracks, creates a new playlist, sets a custom cover image, and returns the shareable playlist link for the event page.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['content', 'marketing', 'automation'],
    },
    {
      icon: SpotifyIcon,
      title: 'Spotify podcast episode digest',
      prompt:
        'Create a scheduled workflow that fetches the latest episodes for a set of Spotify shows, summarizes each episode’s description, and emails a weekly listening digest to the team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['content', 'reporting', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SpotifyIcon,
      title: 'Spotify playlist growth tracker',
      prompt:
        'Build a scheduled workflow that checks the follower count on each of an artist’s Spotify playlists, logs the daily totals to a table, and pings Slack when a playlist crosses a follower milestone.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SpotifyIcon,
      title: 'Spotify new-music newsletter',
      prompt:
        'Create a workflow that searches Spotify for this week’s releases from followed artists, builds a formatted newsletter section with track links, and drafts the email for the music team to send.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'email-marketing', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SpotifyIcon,
      title: 'Spotify follow-status checker',
      prompt:
        'Build a workflow that takes a list of artist IDs, checks whether the connected Spotify account follows each one, and writes the follow status to a table so the team can audit which artists still need following.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
  ],
} as const satisfies BlockMeta
