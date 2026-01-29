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
    'Integrate YouTube into the workflow. Can search for videos, get trending videos, get video details, get video categories, get channel information, get all videos from a channel, get channel playlists, get playlist items, and get video comments.',
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
        { label: 'Get Trending Videos', id: 'youtube_trending' },
        { label: 'Get Video Details', id: 'youtube_video_details' },
        { label: 'Get Video Categories', id: 'youtube_video_categories' },
        { label: 'Get Channel Info', id: 'youtube_channel_info' },
        { label: 'Get Channel Videos', id: 'youtube_channel_videos' },
        { label: 'Get Channel Playlists', id: 'youtube_channel_playlists' },
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
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Token for pagination (from nextPageToken)',
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
      id: 'eventType',
      title: 'Live Stream Filter',
      type: 'dropdown',
      options: [
        { label: 'All Videos', id: '' },
        { label: 'Currently Live', id: 'live' },
        { label: 'Upcoming Streams', id: 'upcoming' },
        { label: 'Past Streams', id: 'completed' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'youtube_search' },
    },
    {
      id: 'publishedAfter',
      title: 'Published After',
      type: 'short-input',
      placeholder: '2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'youtube_search' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:mm:ssZ (UTC timezone).
This is for filtering YouTube videos published after this date.
Examples:
- "last month" -> Calculate 30 days ago at 00:00:00Z
- "beginning of 2024" -> 2024-01-01T00:00:00Z
- "last year" -> Calculate 1 year ago at 00:00:00Z
- "past 7 days" -> Calculate 7 days ago at 00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start date (e.g., "last month", "beginning of 2024")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'publishedBefore',
      title: 'Published Before',
      type: 'short-input',
      placeholder: '2024-12-31T23:59:59Z',
      condition: { field: 'operation', value: 'youtube_search' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:mm:ssZ (UTC timezone).
This is for filtering YouTube videos published before this date.
Examples:
- "today" -> Today's date at 23:59:59Z
- "end of 2024" -> 2024-12-31T23:59:59Z
- "yesterday" -> Yesterday's date at 23:59:59Z
- "end of last month" -> Last day of previous month at 23:59:59Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end date (e.g., "today", "end of last year")...',
        generationType: 'timestamp',
      },
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
      placeholder: 'Use Get Video Categories to find IDs',
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
      condition: {
        field: 'operation',
        value: ['youtube_search', 'youtube_trending', 'youtube_video_categories'],
      },
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
    // Get Trending Videos operation inputs
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'slider',
      min: 1,
      max: 50,
      step: 1,
      integer: true,
      condition: { field: 'operation', value: 'youtube_trending' },
    },
    {
      id: 'videoCategoryId',
      title: 'Category ID',
      type: 'short-input',
      placeholder: 'Use Get Video Categories to find IDs',
      condition: { field: 'operation', value: 'youtube_trending' },
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Token for pagination (from nextPageToken)',
      condition: { field: 'operation', value: 'youtube_trending' },
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
    // Get Video Categories operation inputs
    {
      id: 'hl',
      title: 'Language',
      type: 'short-input',
      placeholder: 'en, es, fr (for category names)',
      condition: { field: 'operation', value: 'youtube_video_categories' },
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
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Token for pagination (from nextPageToken)',
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
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Token for pagination (from nextPageToken)',
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
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Token for pagination (from nextPageToken)',
      condition: { field: 'operation', value: 'youtube_playlist_items' },
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
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Token for pagination (from nextPageToken)',
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
      'youtube_channel_info',
      'youtube_channel_playlists',
      'youtube_channel_videos',
      'youtube_comments',
      'youtube_playlist_items',
      'youtube_search',
      'youtube_trending',
      'youtube_video_categories',
      'youtube_video_details',
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
          case 'youtube_trending':
            return 'youtube_trending'
          case 'youtube_video_details':
            return 'youtube_video_details'
          case 'youtube_video_categories':
            return 'youtube_video_categories'
          case 'youtube_channel_info':
            return 'youtube_channel_info'
          case 'youtube_channel_videos':
            return 'youtube_channel_videos'
          case 'youtube_channel_playlists':
            return 'youtube_channel_playlists'
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
    pageToken: { type: 'string', description: 'Page token for pagination' },
    // Search Filters
    publishedAfter: { type: 'string', description: 'Published after date (RFC 3339)' },
    publishedBefore: { type: 'string', description: 'Published before date (RFC 3339)' },
    videoDuration: { type: 'string', description: 'Video duration filter' },
    videoCategoryId: { type: 'string', description: 'YouTube category ID' },
    videoDefinition: { type: 'string', description: 'Video quality filter' },
    videoCaption: { type: 'string', description: 'Caption availability filter' },
    eventType: { type: 'string', description: 'Live stream filter (live/upcoming/completed)' },
    regionCode: { type: 'string', description: 'Region code (ISO 3166-1)' },
    relevanceLanguage: { type: 'string', description: 'Language code (ISO 639-1)' },
    safeSearch: { type: 'string', description: 'Safe search level' },
    hl: { type: 'string', description: 'Language for category names' },
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
    // Search Videos, Trending, Playlist Items, Captions, Categories
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
    favoriteCount: { type: 'number', description: 'Favorite count' },
    thumbnail: { type: 'string', description: 'Thumbnail URL' },
    tags: { type: 'json', description: 'Video tags' },
    categoryId: { type: 'string', description: 'Video category ID' },
    definition: { type: 'string', description: 'Video definition (hd/sd)' },
    caption: { type: 'string', description: 'Has captions (true/false)' },
    licensedContent: { type: 'boolean', description: 'Is licensed content' },
    privacyStatus: { type: 'string', description: 'Privacy status' },
    liveBroadcastContent: { type: 'string', description: 'Live broadcast status' },
    defaultLanguage: { type: 'string', description: 'Default language' },
    defaultAudioLanguage: { type: 'string', description: 'Default audio language' },
    // Live Streaming Details
    isLiveContent: { type: 'boolean', description: 'Whether video is/was a live stream' },
    scheduledStartTime: { type: 'string', description: 'Scheduled start time for live streams' },
    actualStartTime: { type: 'string', description: 'Actual start time of live stream' },
    actualEndTime: { type: 'string', description: 'End time of live stream' },
    concurrentViewers: { type: 'number', description: 'Current viewers (live only)' },
    activeLiveChatId: { type: 'string', description: 'Live chat ID' },
    // Channel Info
    subscriberCount: { type: 'number', description: 'Subscriber count' },
    videoCount: { type: 'number', description: 'Total video count' },
    customUrl: { type: 'string', description: 'Channel custom URL' },
    country: { type: 'string', description: 'Channel country' },
    uploadsPlaylistId: { type: 'string', description: 'Uploads playlist ID' },
    bannerImageUrl: { type: 'string', description: 'Channel banner URL' },
    hiddenSubscriberCount: { type: 'boolean', description: 'Is subscriber count hidden' },
    // Video Categories
    assignable: { type: 'boolean', description: 'Whether category can be assigned' },
  },
}
