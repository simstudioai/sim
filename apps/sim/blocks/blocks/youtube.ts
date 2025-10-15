import { YouTubeIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { YouTubeResponse } from '@/tools/youtube/types'

export const YouTubeBlock: BlockConfig<YouTubeResponse> = {
  type: 'youtube',
  name: 'YouTube',
  description: 'Interact with YouTube videos, channels, and playlists',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate YouTube into the workflow. Can search for videos, get video details, get channel information, get playlist items, and get video comments.',
  docsLink: 'https://docs.sim.ai/tools/youtube',
  category: 'tools',
  bgColor: '#FF0000',
  icon: YouTubeIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Search Videos', id: 'youtube_search' },
        { label: 'Get Video Details', id: 'youtube_video_details' },
        { label: 'Get Channel Info', id: 'youtube_channel_info' },
        { label: 'Get Playlist Items', id: 'youtube_playlist_items' },
        { label: 'Get Video Comments', id: 'youtube_comments' },
      ],
      value: () => 'youtube_search',
    },
    // Search Videos operation inputs
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter search query',
      required: true,
      condition: { field: 'operation', value: 'youtube_search' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'slider',
      layout: 'half',
      min: 1,
      max: 50,
      step: 1,
      integer: true,
      condition: { field: 'operation', value: 'youtube_search' },
    },
    // Get Video Details operation inputs
    {
      id: 'videoId',
      title: 'Video ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter YouTube video ID (e.g., dQw4w9WgXcQ)',
      required: true,
      condition: { field: 'operation', value: 'youtube_video_details' },
    },
    // Get Channel Info operation inputs
    {
      id: 'channelId',
      title: 'Channel ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter channel ID (or leave blank to use username)',
      condition: { field: 'operation', value: 'youtube_channel_info' },
    },
    {
      id: 'username',
      title: 'Channel Username',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter channel username (if not using channel ID)',
      condition: { field: 'operation', value: 'youtube_channel_info' },
    },
    // Get Playlist Items operation inputs
    {
      id: 'playlistId',
      title: 'Playlist ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter YouTube playlist ID',
      required: true,
      condition: { field: 'operation', value: 'youtube_playlist_items' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'slider',
      layout: 'half',
      min: 1,
      max: 50,
      step: 1,
      integer: true,
      condition: { field: 'operation', value: 'youtube_playlist_items' },
    },
    // Get Video Comments operation inputs
    {
      id: 'videoId',
      title: 'Video ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter YouTube video ID',
      required: true,
      condition: { field: 'operation', value: 'youtube_comments' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'slider',
      layout: 'half',
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      condition: { field: 'operation', value: 'youtube_comments' },
    },
    {
      id: 'order',
      title: 'Sort Order',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Most Relevant', id: 'relevance' },
        { label: 'Most Recent', id: 'time' },
      ],
      value: () => 'relevance',
      condition: { field: 'operation', value: 'youtube_comments' },
    },
    // API Key (common to all operations)
    {
      id: 'apiKey',
      title: 'YouTube API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter YouTube API Key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'youtube_search',
      'youtube_video_details',
      'youtube_channel_info',
      'youtube_playlist_items',
      'youtube_comments',
    ],
    config: {
      tool: (params) => {
        // Convert numeric parameters
        if (params.maxResults) {
          params.maxResults = Number(params.maxResults)
        }

        switch (params.operation) {
          case 'youtube_search':
            return 'youtube_search'
          case 'youtube_video_details':
            return 'youtube_video_details'
          case 'youtube_channel_info':
            return 'youtube_channel_info'
          case 'youtube_playlist_items':
            return 'youtube_playlist_items'
          case 'youtube_comments':
            return 'youtube_comments'
          default:
            return 'youtube_search'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'YouTube API key' },
    // Search Videos
    query: { type: 'string', description: 'Search query' },
    maxResults: { type: 'number', description: 'Maximum number of results' },
    // Video Details & Comments
    videoId: { type: 'string', description: 'YouTube video ID' },
    // Channel Info
    channelId: { type: 'string', description: 'YouTube channel ID' },
    username: { type: 'string', description: 'YouTube channel username' },
    // Playlist Items
    playlistId: { type: 'string', description: 'YouTube playlist ID' },
    // Comments
    order: { type: 'string', description: 'Sort order for comments' },
  },
  outputs: {
    // Search Videos & Playlist Items
    items: { type: 'json', description: 'List of items returned' },
    totalResults: { type: 'number', description: 'Total number of results' },
    nextPageToken: { type: 'string', description: 'Token for next page' },
    // Video Details
    videoId: { type: 'string', description: 'Video ID' },
    title: { type: 'string', description: 'Video or channel title' },
    description: { type: 'string', description: 'Video or channel description' },
    channelId: { type: 'string', description: 'Channel ID' },
    channelTitle: { type: 'string', description: 'Channel name' },
    publishedAt: { type: 'string', description: 'Published date' },
    duration: { type: 'string', description: 'Video duration' },
    viewCount: { type: 'number', description: 'View count' },
    likeCount: { type: 'number', description: 'Like count' },
    commentCount: { type: 'number', description: 'Comment count' },
    thumbnail: { type: 'string', description: 'Thumbnail URL' },
    tags: { type: 'json', description: 'Video tags' },
    // Channel Info
    subscriberCount: { type: 'number', description: 'Subscriber count' },
    videoCount: { type: 'number', description: 'Total video count' },
    customUrl: { type: 'string', description: 'Channel custom URL' },
  },
}
