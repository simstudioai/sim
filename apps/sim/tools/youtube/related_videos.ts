import type { ToolConfig } from '@/tools/types'
import type {
  YouTubeRelatedVideosParams,
  YouTubeRelatedVideosResponse,
} from '@/tools/youtube/types'

export const youtubeRelatedVideosTool: ToolConfig<
  YouTubeRelatedVideosParams,
  YouTubeRelatedVideosResponse
> = {
  id: 'youtube_related_videos',
  name: 'YouTube Related Videos',
  description: 'Find videos related to a specific YouTube video.',
  version: '1.0.0',
  params: {
    videoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'YouTube video ID to find related videos for',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      default: 10,
      description: 'Maximum number of related videos to return (1-50)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Page token for pagination',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'YouTube API Key',
    },
  },

  request: {
    url: (params: YouTubeRelatedVideosParams) => {
      let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&relatedToVideoId=${encodeURIComponent(
        params.videoId
      )}&key=${params.apiKey}`
      url += `&maxResults=${Number(params.maxResults || 10)}`
      if (params.pageToken) {
        url += `&pageToken=${params.pageToken}`
      }
      return url
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<YouTubeRelatedVideosResponse> => {
    const data = await response.json()
    const items = (data.items || []).map((item: any) => ({
      videoId: item.id?.videoId,
      title: item.snippet?.title,
      description: item.snippet?.description,
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        item.snippet?.thumbnails?.high?.url ||
        '',
      channelTitle: item.snippet?.channelTitle || '',
    }))
    return {
      success: true,
      output: {
        items,
        totalResults: data.pageInfo?.totalResults || 0,
        nextPageToken: data.nextPageToken,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Array of related videos',
      items: {
        type: 'object',
        properties: {
          videoId: { type: 'string', description: 'YouTube video ID' },
          title: { type: 'string', description: 'Video title' },
          description: { type: 'string', description: 'Video description' },
          thumbnail: { type: 'string', description: 'Video thumbnail URL' },
          channelTitle: { type: 'string', description: 'Channel name' },
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total number of related videos available',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for accessing the next page of results',
      optional: true,
    },
  },
}
