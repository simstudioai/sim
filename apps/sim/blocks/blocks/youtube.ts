import { YouTubeIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { YouTubeSearchResponse } from '@/tools/youtube/types'

export const YouTubeBlock: BlockConfig<YouTubeSearchResponse> = {
  type: 'youtube',
  name: 'YouTube',
  description: 'Search for videos on YouTube',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate YouTube into the workflow. Can search for videos.',
  docsLink: 'https://docs.sim.ai/tools/youtube',
  category: 'tools',
  bgColor: '#FF0000',
  icon: YouTubeIcon,
  subBlocks: [
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter search query',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'YouTube API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter YouTube API Key',
      password: true,
      required: true,
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'slider',
      layout: 'half',
      min: 0,
      max: 20,
    },
  ],
  tools: {
    access: ['youtube_search'],
  },
  inputs: {
    apiKey: { type: 'string', description: 'The API key for the YouTube search' },
    query: { type: 'string', description: 'The query for the YouTube search' },
    maxResults: { type: 'number', description: 'The maximum number of results to return' },
  },
  outputs: {
    items: { type: 'json', description: 'The items returned by the YouTube search' },
    totalResults: {
      type: 'number',
      description: 'The total number of results returned by the YouTube search',
    },
  },
}
