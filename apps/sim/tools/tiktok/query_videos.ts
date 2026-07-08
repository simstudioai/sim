import type {
  TikTokQueryVideosParams,
  TikTokQueryVideosResponse,
  TikTokVideo,
} from '@/tools/tiktok/types'
import { mapTikTokVideo, TIKTOK_VIDEO_FIELDS } from '@/tools/tiktok/utils'
import type { ToolConfig } from '@/tools/types'

export const tiktokQueryVideosTool: ToolConfig<TikTokQueryVideosParams, TikTokQueryVideosResponse> =
  {
    id: 'tiktok_query_videos',
    name: 'TikTok Query Videos',
    description:
      'Query specific TikTok videos by their IDs to get fresh metadata including cover images, embed links, and video details.',
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
      videoIds: {
        type: 'array',
        required: true,
        visibility: 'user-or-llm',
        description: 'Array of video IDs to query (maximum 20)',
        items: {
          type: 'string',
          description: 'TikTok video ID',
        },
      },
    },

    request: {
      url: () => `https://open.tiktokapis.com/v2/video/query/?fields=${TIKTOK_VIDEO_FIELDS}`,
      method: 'POST',
      headers: (params: TikTokQueryVideosParams) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
      body: (params: TikTokQueryVideosParams) => ({
        filters: {
          video_ids: params.videoIds,
        },
      }),
    },

    transformResponse: async (response: Response): Promise<TikTokQueryVideosResponse> => {
      const data = await response.json()

      if (data.error?.code !== 'ok' && data.error?.code) {
        return {
          success: false,
          output: {
            videos: [],
          },
          error: data.error?.message || 'Failed to query videos',
        }
      }

      const videos: TikTokVideo[] = (data.data?.videos ?? []).map(mapTikTokVideo)

      return {
        success: true,
        output: {
          videos,
        },
      }
    },

    outputs: {
      videos: {
        type: 'array',
        description: 'List of queried TikTok videos',
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
    },
  }
