import type { TikTokGetPostStatusParams, TikTokGetPostStatusResponse } from '@/tools/tiktok/types'
import type { ToolConfig } from '@/tools/types'

export const tiktokGetPostStatusTool: ToolConfig<
  TikTokGetPostStatusParams,
  TikTokGetPostStatusResponse
> = {
  id: 'tiktok_get_post_status',
  name: 'TikTok Get Post Status',
  description:
    'Check the status of a video post initiated with Direct Post Video. Use the publishId returned from the post request to track progress.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'tiktok',
    requiredScopes: ['video.publish'],
  },

  params: {
    publishId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The publish ID returned from the Direct Post Video tool.',
    },
  },

  request: {
    url: () => 'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
    method: 'POST',
    headers: (params: TikTokGetPostStatusParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    }),
    body: (params: TikTokGetPostStatusParams) => ({
      publish_id: params.publishId,
    }),
  },

  transformResponse: async (response: Response): Promise<TikTokGetPostStatusResponse> => {
    const data = await response.json()

    if (data.error?.code !== 'ok' && data.error?.code) {
      return {
        success: false,
        output: {
          status: '',
          failReason: null,
          publiclyAvailablePostId: [],
        },
        error: data.error?.message || 'Failed to fetch post status',
      }
    }

    const statusData = data.data

    if (!statusData) {
      return {
        success: false,
        output: {
          status: '',
          failReason: null,
          publiclyAvailablePostId: [],
        },
        error: 'No status data returned',
      }
    }

    return {
      success: true,
      output: {
        status: statusData.status ?? '',
        failReason: statusData.fail_reason ?? null,
        publiclyAvailablePostId: statusData.publicaly_available_post_id ?? [],
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description:
        'Current status of the post. Values: PROCESSING_DOWNLOAD (TikTok is downloading the video), PUBLISH_COMPLETE (successfully posted), FAILED (check failReason).',
    },
    failReason: {
      type: 'string',
      description: 'Reason for failure if status is FAILED. Null otherwise.',
      optional: true,
    },
    publiclyAvailablePostId: {
      type: 'array',
      description:
        'Array of public post IDs once the video is published. Can be used to construct the TikTok video URL.',
    },
  },
}
