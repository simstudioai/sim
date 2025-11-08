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
    'Integrate YouTube into the workflow. Can search for videos, get video details, get channel information, get all videos from a channel, get channel playlists, get playlist items, find related videos, and get video comments.',
  docsLink: 'https://docs.sim.ai/tools/youtube',
  category: 'tools',
  bgColor: '#FF0000',
  icon: YouTubeIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search Videos', id: 'youtube_search' },
        { label: 'Get Video Details', id: 'youtube_video_details' },
        { label: 'Get Channel Info', id: 'youtube_channel_info' },
        { label: 'Get Channel Videos', id: 'youtube_channel_videos' },
        { label: 'Get Channel Playlists', id: 'youtube_channel_playlists' },
        { label: 'Get Playlist Items', id: 'youtube_playlist_items' },
        { label: 'Get Related Videos', id: 'youtube_related_videos' },
        { label: 'Get Video Comments', id: 'youtube_comments' },
      ],
      value: () => 'youtube_search',
    },
    // Search Videos operation inputs
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter search query',
      required: true,
      condition: { field: 'operation', value: 'youtube_search' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'slider',
      min: 1,
      max: 50,
      step: 1,
      integer: true,
      condition: { field: 'operation', value: 'youtube_search' },
    },
    {
      id: 'channelId',
      title: 'Filter by Channel ID',
      type: 'short-input',
      placeholder: 'Filter results to a specific channel',
      condition: { field: 'operation', value: 'youtube_search' },
    },
    {
      id: 'publishedAfter',
      title: 'Published After',
      type: 'short-input',
      placeholder: '2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'youtube_search' },
    },
    {
      id: 'publishedBefore',
      title: 'Published Before',
      type: 'short-input',
      placeholder: '2024-12-31T23:59:59Z',
      condition: { field: 'operation', value: 'youtube_search' },
    },
    {
      id: 'videoDuration',
      title: 'Video Duration',
      type: 'dropdown',
      options: [
        { label: 'Any', id: 'any' },
        { label: 'Short (<4 min)', id: 'short' },
        { label: 'Medium (4-20 min)', id: 'medium' },
        { label: 'Long (>20 min)', id: 'long' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'youtube_search' },
    },
    {
      id: 'order',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Relevance', id: 'relevance' },
        { label: 'Date (Newest First)', id: 'date' },
        { label: 'View Count', id: 'viewCount' },
        { label: 'Rating', id: 'rating' },
        { label: 'Title', id: 'title' },
      ],
      value: () => 'relevance',
      condition: { field: 'operation', value: 'youtube_search' },
    },
    {
      id: 'videoCategoryId',
      title: 'Category ID',
      type: 'short-input',
      placeholder: '10 for Music, 20 for Gaming',
      condition: { field: 'operation', value: 'youtube_search' },
    },
    {
      id: 'videoDefinition',
      title: 'Video Quality',
      type: 'dropdown',
      options: [
        { label: 'Any', id: 'any' },
        { label: 'HD', id: 'high' },
        { label: 'Standard', id: 'standard' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'youtube_search' },
    },
    {
      id: 'videoCaption',
      title: 'Captions',
      type: 'dropdown',
      options: [
        { label: 'Any', id: 'any' },
        { label: 'Has Captions', id: 'closedCaption' },
        { label: 'No Captions', id: 'none' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'youtube_search' },
    },
    {
      id: 'regionCode',
      title: 'Region Code',
      type: 'short-input',
      placeholder: 'US, GB, JP',
      condition: { field: 'operation', value: 'youtube_search' },
    },
    {
      id: 'relevanceLanguage',
      title: 'Language Code',
      type: 'short-input',
      placeholder: 'en, es, fr',
      condition: { field: 'operation', value: 'youtube_search' },
    },
    {
      id: 'safeSearch',
      title: 'Safe Search',
      type: 'dropdown',
      options: [
        { label: 'Moderate', id: 'moderate' },
        { label: 'None', id: 'none' },
        { label: 'Strict', id: 'strict' },
      ],
      value: () => 'moderate',
      condition: { field: 'operation', value: 'youtube_search' },
    },
    // Get Video Details operation inputs
    {
      id: 'videoId',
      title: 'Video ID',
      type: 'short-input',
      placeholder: 'Enter YouTube video ID',
      required: true,
      condition: { field: 'operation', value: 'youtube_video_details' },
    },
    // Get Channel Info operation inputs
    {
      id: 'channelId',
      title: 'Channel ID',
      type: 'short-input',
      placeholder: 'Enter channel ID (or leave blank to use username)',
      condition: { field: 'operation', value: 'youtube_channel_info' },
    },
    {
      id: 'username',
      title: 'Channel Username',
      type: 'short-input',
      placeholder: 'Enter channel username (if not using channel ID)',
      condition: { field: 'operation', value: 'youtube_channel_info' },
    },
    // Get Channel Videos operation inputs
    {
      id: 'channelId',
      title: 'Channel ID',
      type: 'short-input',
      placeholder: 'Enter YouTube channel ID',
      required: true,
      condition: { field: 'operation', value: 'youtube_channel_videos' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'slider',
      min: 1,
      max: 50,
      step: 1,
      integer: true,
      condition: { field: 'operation', value: 'youtube_channel_videos' },
    },
    {
      id: 'order',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Date (Newest First)', id: 'date' },
        { label: 'Relevance', id: 'relevance' },
        { label: 'View Count', id: 'viewCount' },
        { label: 'Rating', id: 'rating' },
        { label: 'Title', id: 'title' },
      ],
      value: () => 'date',
      condition: { field: 'operation', value: 'youtube_channel_videos' },
    },
    // Get Channel Playlists operation inputs
    {
      id: 'channelId',
      title: 'Channel ID',
      type: 'short-input',
      placeholder: 'Enter YouTube channel ID',
      required: true,
      condition: { field: 'operation', value: 'youtube_channel_playlists' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'slider',
      min: 1,
      max: 50,
      step: 1,
      integer: true,
      condition: { field: 'operation', value: 'youtube_channel_playlists' },
    },
    // Get Playlist Items operation inputs
    {
      id: 'playlistId',
      title: 'Playlist ID',
      type: 'short-input',
      placeholder: 'Enter YouTube playlist ID',
      required: true,
      condition: { field: 'operation', value: 'youtube_playlist_items' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'slider',
      min: 1,
      max: 50,
      step: 1,
      integer: true,
      condition: { field: 'operation', value: 'youtube_playlist_items' },
    },
    // Get Related Videos operation inputs
    {
      id: 'videoId',
      title: 'Video ID',
      type: 'short-input',
      placeholder: 'Enter YouTube video ID to find related videos',
      required: true,
      condition: { field: 'operation', value: 'youtube_related_videos' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'slider',
      min: 1,
      max: 50,
      step: 1,
      integer: true,
      condition: { field: 'operation', value: 'youtube_related_videos' },
    },
    // Get Video Comments operation inputs
    {
      id: 'videoId',
      title: 'Video ID',
      type: 'short-input',
      placeholder: 'Enter YouTube video ID',
      required: true,
      condition: { field: 'operation', value: 'youtube_comments' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'slider',
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
      'youtube_channel_videos',
      'youtube_channel_playlists',
      'youtube_playlist_items',
      'youtube_related_videos',
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
          case 'youtube_channel_videos':
            return 'youtube_channel_videos'
          case 'youtube_channel_playlists':
            return 'youtube_channel_playlists'
          case 'youtube_playlist_items':
            return 'youtube_playlist_items'
          case 'youtube_related_videos':
            return 'youtube_related_videos'
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
    // Search Filters
    publishedAfter: { type: 'string', description: 'Published after date (RFC 3339)' },
    publishedBefore: { type: 'string', description: 'Published before date (RFC 3339)' },
    videoDuration: { type: 'string', description: 'Video duration filter' },
    videoCategoryId: { type: 'string', description: 'YouTube category ID' },
    videoDefinition: { type: 'string', description: 'Video quality filter' },
    videoCaption: { type: 'string', description: 'Caption availability filter' },
    regionCode: { type: 'string', description: 'Region code (ISO 3166-1)' },
    relevanceLanguage: { type: 'string', description: 'Language code (ISO 639-1)' },
    safeSearch: { type: 'string', description: 'Safe search level' },
    // Video Details & Comments
    videoId: { type: 'string', description: 'YouTube video ID' },
    // Channel Info
    channelId: { type: 'string', description: 'YouTube channel ID' },
    username: { type: 'string', description: 'YouTube channel username' },
    // Playlist Items
    playlistId: { type: 'string', description: 'YouTube playlist ID' },
    // Sort Order (used by multiple operations)
    order: { type: 'string', description: 'Sort order' },
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
