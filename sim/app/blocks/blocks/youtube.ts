import { YouTubeIcon } from '@/components/icons'
import { YouTubeSearchResponse } from '@/tools/youtube/search'
import { BlockConfig } from '../types'

export const YouTubeBlock: BlockConfig<YouTubeSearchResponse> = {
  type: 'youtube',
  name: 'YouTube',
  description: 'Search for videos on YouTube',
  longDescription:
    'Find relevant videos on YouTube using the YouTube Data API. Search for content with customizable result limits and retrieve structured video metadata for integration into your workflow.',
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
    },
    {
      id: 'apiKey',
      title: 'YouTube API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter YouTube API Key',
      password: true,
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
    apiKey: { type: 'string', required: true },
    query: { type: 'string', required: true },
    maxResults: { type: 'number', required: false },
  },
  outputs: {
    response: {
      type: {
        items: 'json',
        totalResults: 'number',
      },
    },
  },
}
