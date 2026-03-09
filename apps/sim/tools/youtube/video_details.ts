import type { ToolConfig } from '@/tools/types'
import type { YouTubeVideoDetailsParams, YouTubeVideoDetailsResponse } from '@/tools/youtube/types'

export const youtubeVideoDetailsTool: ToolConfig<
  YouTubeVideoDetailsParams,
  YouTubeVideoDetailsResponse
> = {
  id: 'youtube_video_details',
  name: 'YouTube Video Details',
  description:
    'Get detailed information about a specific YouTube video including statistics, content details, live streaming info, and metadata.',
  version: '1.2.0',
  params: {
    videoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'YouTube video ID (11-character string, e.g., "dQw4w9WgXcQ")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'YouTube API Key',
    },
  },

  request: {
    url: (params: YouTubeVideoDetailsParams) => {
      return `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,status,liveStreamingDetails&id=${encodeURIComponent(params.videoId)}&key=${params.apiKey}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<YouTubeVideoDetailsResponse> => {
    const data = await response.json()

    if (!data.items || data.items.length === 0) {
      return {
        success: false,
        output: {
          videoId: '',
          title: '',
          description: '',
          channelId: '',
          channelTitle: '',
          publishedAt: '',
          duration: '',
          viewCount: 0,
          likeCount: 0,
          commentCount: 0,
          favoriteCount: 0,
          thumbnail: '',
          tags: [],
          categoryId: null,
          definition: null,
          caption: null,
          licensedContent: null,
          privacyStatus: null,
          liveBroadcastContent: null,
          defaultLanguage: null,
          defaultAudioLanguage: null,
          isLiveContent: false,
          scheduledStartTime: null,
          actualStartTime: null,
          actualEndTime: null,
          concurrentViewers: null,
          activeLiveChatId: null,
        },
        error: 'Video not found',
      }
    }

    const item = data.items[0]
    const liveDetails = item.liveStreamingDetails

    return {
      success: true,
      output: {
        videoId: item.id ?? '',
        title: item.snippet?.title ?? '',
        description: item.snippet?.description ?? '',
        channelId: item.snippet?.channelId ?? '',
        channelTitle: item.snippet?.channelTitle ?? '',
        publishedAt: item.snippet?.publishedAt ?? '',
        duration: item.contentDetails?.duration ?? '',
        viewCount: Number(item.statistics?.viewCount || 0),
        likeCount: Number(item.statistics?.likeCount || 0),
        commentCount: Number(item.statistics?.commentCount || 0),
        favoriteCount: Number(item.statistics?.favoriteCount || 0),
        thumbnail:
          item.snippet?.thumbnails?.high?.url ||
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          '',
        tags: item.snippet?.tags ?? [],
        categoryId: item.snippet?.categoryId ?? null,
        definition: item.contentDetails?.definition ?? null,
        caption: item.contentDetails?.caption ?? null,
        licensedContent: item.contentDetails?.licensedContent ?? null,
        privacyStatus: item.status?.privacyStatus ?? null,
        liveBroadcastContent: item.snippet?.liveBroadcastContent ?? null,
        defaultLanguage: item.snippet?.defaultLanguage ?? null,
        defaultAudioLanguage: item.snippet?.defaultAudioLanguage ?? null,
        // Live streaming details
        isLiveContent: liveDetails !== undefined,
        scheduledStartTime: liveDetails?.scheduledStartTime ?? null,
        actualStartTime: liveDetails?.actualStartTime ?? null,
        actualEndTime: liveDetails?.actualEndTime ?? null,
        concurrentViewers: liveDetails?.concurrentViewers
          ? Number(liveDetails.concurrentViewers)
          : null,
        activeLiveChatId: liveDetails?.activeLiveChatId ?? null,
      },
    }
  },

  outputs: {
    videoId: {
      type: 'string',
      description: 'YouTube video ID',
    },
    title: {
      type: 'string',
      description: 'Video title',
    },
    description: {
      type: 'string',
      description: 'Video description',
    },
    channelId: {
      type: 'string',
      description: 'Channel ID',
    },
    channelTitle: {
      type: 'string',
      description: 'Channel name',
    },
    publishedAt: {
      type: 'string',
      description: 'Published date and time',
    },
    duration: {
      type: 'string',
      description: 'Video duration in ISO 8601 format (e.g., "PT4M13S" for 4 min 13 sec)',
    },
    viewCount: {
      type: 'number',
      description: 'Number of views',
    },
    likeCount: {
      type: 'number',
      description: 'Number of likes',
    },
    commentCount: {
      type: 'number',
      description: 'Number of comments',
    },
    favoriteCount: {
      type: 'number',
      description: 'Number of times added to favorites',
    },
    thumbnail: {
      type: 'string',
      description: 'Video thumbnail URL',
    },
    tags: {
      type: 'array',
      description: 'Video tags',
      items: {
        type: 'string',
      },
    },
    categoryId: {
      type: 'string',
      description: 'YouTube video category ID',
      optional: true,
    },
    definition: {
      type: 'string',
      description: 'Video definition: "hd" or "sd"',
      optional: true,
    },
    caption: {
      type: 'string',
      description: 'Whether captions are available: "true" or "false"',
      optional: true,
    },
    licensedContent: {
      type: 'boolean',
      description: 'Whether the video is licensed content',
      optional: true,
    },
    privacyStatus: {
      type: 'string',
      description: 'Video privacy status: "public", "private", or "unlisted"',
      optional: true,
    },
    liveBroadcastContent: {
      type: 'string',
      description: 'Live broadcast status: "live", "upcoming", or "none"',
      optional: true,
    },
    defaultLanguage: {
      type: 'string',
      description: 'Default language of the video metadata',
      optional: true,
    },
    defaultAudioLanguage: {
      type: 'string',
      description: 'Default audio language of the video',
      optional: true,
    },
    isLiveContent: {
      type: 'boolean',
      description: 'Whether this video is or was a live stream',
    },
    scheduledStartTime: {
      type: 'string',
      description: 'Scheduled start time for upcoming live streams (ISO 8601)',
      optional: true,
    },
    actualStartTime: {
      type: 'string',
      description: 'When the live stream actually started (ISO 8601)',
      optional: true,
    },
    actualEndTime: {
      type: 'string',
      description: 'When the live stream ended (ISO 8601)',
      optional: true,
    },
    concurrentViewers: {
      type: 'number',
      description: 'Current number of viewers (only for active live streams)',
      optional: true,
    },
    activeLiveChatId: {
      type: 'string',
      description: 'Live chat ID for the stream (only for active live streams)',
      optional: true,
    },
  },
}
