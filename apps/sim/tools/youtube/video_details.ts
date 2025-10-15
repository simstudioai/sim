import type { ToolConfig } from '@/tools/types'
import type { YouTubeVideoDetailsParams, YouTubeVideoDetailsResponse } from '@/tools/youtube/types'

export const youtubeVideoDetailsTool: ToolConfig<
  YouTubeVideoDetailsParams,
  YouTubeVideoDetailsResponse
> = {
  id: 'youtube_video_details',
  name: 'YouTube Video Details',
  description: 'Get detailed information about a specific YouTube video.',
  version: '1.0.0',
  params: {
    videoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'YouTube video ID',
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
      return `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${params.videoId}&key=${params.apiKey}`
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
          thumbnail: '',
        },
        error: 'Video not found',
      }
    }

    const item = data.items[0]
    return {
      success: true,
      output: {
        videoId: item.id,
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
        channelId: item.snippet?.channelId || '',
        channelTitle: item.snippet?.channelTitle || '',
        publishedAt: item.snippet?.publishedAt || '',
        duration: item.contentDetails?.duration || '',
        viewCount: Number(item.statistics?.viewCount || 0),
        likeCount: Number(item.statistics?.likeCount || 0),
        commentCount: Number(item.statistics?.commentCount || 0),
        thumbnail:
          item.snippet?.thumbnails?.high?.url ||
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          '',
        tags: item.snippet?.tags || [],
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
      description: 'Video duration in ISO 8601 format',
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
      optional: true,
    },
  },
}
