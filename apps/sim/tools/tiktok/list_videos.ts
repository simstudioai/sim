import type {
  TikTokListVideosParams,
  TikTokListVideosResponse,
  TikTokVideo,
} from '@/tools/tiktok/types'
import { mapTikTokVideo, TIKTOK_VIDEO_FIELDS } from '@/tools/tiktok/utils'
import type { ToolConfig } from '@/tools/types'

export const tiktokListVideosTool: ToolConfig<TikTokListVideosParams, TikTokListVideosResponse> = {
  id: 'tiktok_list_videos',
  name: 'TikTok List Videos',
  description:
    "Get a list of the authenticated user's TikTok videos with cover images, titles, and metadata. Supports pagination.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'tiktok',
    requiredScopes: ['video.list'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'TikTok OAuth access token',
    },
    maxCount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Maximum number of videos to return (1-20)',
    },
    cursor: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination (from previous response)',
    },
  },

  request: {
    url: () => `https://open.tiktokapis.com/v2/video/list/?fields=${TIKTOK_VIDEO_FIELDS}`,
    method: 'POST',
    headers: (params: TikTokListVideosParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: TikTokListVideosParams) => ({
      max_count: params.maxCount || 20,
      ...(params.cursor !== undefined && { cursor: params.cursor }),
    }),
  },

  transformResponse: async (response: Response): Promise<TikTokListVideosResponse> => {
    const data = await response.json()

    if (data.error?.code !== 'ok' && data.error?.code) {
      return {
        success: false,
        output: {
          videos: [],
          cursor: null,
          hasMore: false,
        },
        error: data.error?.message || 'Failed to fetch videos',
      }
    }

    const videos: TikTokVideo[] = (data.data?.videos ?? []).map(mapTikTokVideo)

    return {
      success: true,
      output: {
        videos,
        cursor: data.data?.cursor ?? null,
        hasMore: data.data?.has_more ?? false,
      },
    }
  },

  outputs: {
    videos: {
      type: 'array',
      description: 'List of TikTok videos',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Video ID' },
          title: { type: 'string', description: 'Video title', optional: true },
          coverImageUrl: {
            type: 'string',
            description:
              'Signed cover image URL from TikTok CDN. Publicly fetchable without auth, but time-limited (embeds an x-expires param) — use it right away rather than storing it for later.',
            optional: true,
          },
          embedLink: { type: 'string', description: 'Embeddable video URL', optional: true },
          duration: { type: 'number', description: 'Video duration in seconds', optional: true },
          createTime: {
            type: 'number',
            description: 'Unix timestamp when video was created',
            optional: true,
          },
          shareUrl: { type: 'string', description: 'Shareable video URL', optional: true },
          videoDescription: {
            type: 'string',
            description: 'Video description/caption',
            optional: true,
          },
          width: { type: 'number', description: 'Video width in pixels', optional: true },
          height: { type: 'number', description: 'Video height in pixels', optional: true },
          viewCount: { type: 'number', description: 'Number of views', optional: true },
          likeCount: { type: 'number', description: 'Number of likes', optional: true },
          commentCount: { type: 'number', description: 'Number of comments', optional: true },
          shareCount: { type: 'number', description: 'Number of shares', optional: true },
        },
      },
    },
    cursor: {
      type: 'number',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether there are more videos to fetch',
    },
  },
}
