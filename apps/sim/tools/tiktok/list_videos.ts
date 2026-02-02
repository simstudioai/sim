import type {
  TikTokListVideosParams,
  TikTokListVideosResponse,
  TikTokVideo,
} from '@/tools/tiktok/types'
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
    url: () =>
      'https://open.tiktokapis.com/v2/video/list/?fields=id,title,cover_image_url,embed_link,duration,create_time,share_url,video_description,width,height',
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

    const videos: TikTokVideo[] = (data.data?.videos ?? []).map((video: Record<string, unknown>) => ({
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
            description: 'Cover image URL (may expire)',
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
