import { tiktokQueryVideosApiDataSchema } from '@/tools/tiktok/api-schemas'
import {
  TIKTOK_VIDEO_OUTPUT_PROPERTIES,
  type TikTokQueryVideosParams,
  type TikTokQueryVideosResponse,
  type TikTokVideo,
} from '@/tools/tiktok/types'
import {
  assertTikTokArrayLength,
  mapTikTokVideo,
  readTikTokApiResponse,
  TIKTOK_VIDEO_FIELDS,
} from '@/tools/tiktok/utils'
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
      body: (params: TikTokQueryVideosParams) => {
        const videoIds = params.videoIds.map((id) => id.trim()).filter(Boolean)
        assertTikTokArrayLength(videoIds, 'videoIds', 20)
        return {
          filters: {
            video_ids: videoIds,
          },
        }
      },
    },

    transformResponse: async (response: Response): Promise<TikTokQueryVideosResponse> => {
      const { data, error } = await readTikTokApiResponse(response, tiktokQueryVideosApiDataSchema)

      if (error) {
        return {
          success: false,
          output: {
            videos: [],
          },
          error: error.message || 'Failed to query videos',
        }
      }

      if (!data) {
        return {
          success: false,
          output: {
            videos: [],
          },
          error: 'No video query data returned',
        }
      }

      const videos: TikTokVideo[] = data.videos.map(mapTikTokVideo)

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
          properties: TIKTOK_VIDEO_OUTPUT_PROPERTIES,
        },
      },
    },
  }
