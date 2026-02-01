import type {
  TikTokQueryVideosParams,
  TikTokQueryVideosResponse,
  TikTokVideo,
} from '@/tools/tiktok/types'
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
      url: () =>
        'https://open.tiktokapis.com/v2/video/query/?fields=id,title,cover_image_url,embed_link,duration,create_time,share_url,video_description,width,height',
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

      const videos: TikTokVideo[] = (data.data?.videos ?? []).map((video: any) => ({
        id: video.id ?? '',
        title: video.title ?? null,
        coverImageUrl: video.cover_image_url ?? null,
        embedLink: video.embed_link ?? null,
        duration: video.duration ?? null,
        createTime: video.create_time ?? null,
        shareUrl: video.share_url ?? null,
        videoDescription: video.video_description ?? null,
        width: video.width ?? null,
        height: video.height ?? null,
      }))

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
              description: 'Cover image URL (fresh URL)',
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
          },
        },
      },
    },
  }
