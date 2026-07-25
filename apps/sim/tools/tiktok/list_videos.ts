import { tiktokListVideosApiDataSchema } from '@/tools/tiktok/api-schemas'
import {
  TIKTOK_VIDEO_OUTPUT_PROPERTIES,
  type TikTokListVideosParams,
  type TikTokListVideosResponse,
  type TikTokVideo,
} from '@/tools/tiktok/types'
import { mapTikTokVideo, readTikTokApiResponse, TIKTOK_VIDEO_FIELDS } from '@/tools/tiktok/utils'
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
      default: 10,
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
    body: (params: TikTokListVideosParams) => {
      const maxCount = params.maxCount ?? 10
      if (!Number.isInteger(maxCount) || maxCount < 1 || maxCount > 20) {
        throw new Error('maxCount must be an integer between 1 and 20')
      }
      if (params.cursor !== undefined && (!Number.isInteger(params.cursor) || params.cursor < 0)) {
        throw new Error('cursor must be a non-negative integer')
      }
      return {
        max_count: maxCount,
        ...(params.cursor !== undefined && { cursor: params.cursor }),
      }
    },
  },

  transformResponse: async (response: Response): Promise<TikTokListVideosResponse> => {
    const { data, error } = await readTikTokApiResponse(response, tiktokListVideosApiDataSchema)

    if (error) {
      return {
        success: false,
        output: {
          videos: [],
          cursor: null,
          hasMore: false,
        },
        error: error.message || 'Failed to fetch videos',
      }
    }

    if (!data) {
      return {
        success: false,
        output: {
          videos: [],
          cursor: null,
          hasMore: false,
        },
        error: 'No video list data returned',
      }
    }

    const videos: TikTokVideo[] = data.videos.map(mapTikTokVideo)

    return {
      success: true,
      output: {
        videos,
        cursor: data.cursor,
        hasMore: data.has_more,
      },
    }
  },

  outputs: {
    videos: {
      type: 'array',
      description: 'List of TikTok videos',
      items: {
        type: 'object',
        properties: TIKTOK_VIDEO_OUTPUT_PROPERTIES,
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
