import { tiktokPostStatusApiDataSchema } from '@/tools/tiktok/api-schemas'
import type { TikTokGetPostStatusParams, TikTokGetPostStatusResponse } from '@/tools/tiktok/types'
import { readTikTokApiResponse } from '@/tools/tiktok/utils'
import type { ToolConfig } from '@/tools/types'

function emptyPostStatusOutput(): TikTokGetPostStatusResponse['output'] {
  return {
    status: '',
    failReason: null,
    publiclyAvailablePostId: [],
    uploadedBytes: null,
    downloadedBytes: null,
  }
}

export const tiktokGetPostStatusTool: ToolConfig<
  TikTokGetPostStatusParams,
  TikTokGetPostStatusResponse
> = {
  id: 'tiktok_get_post_status',
  name: 'TikTok Get Post Status',
  description:
    'Check the status of a post initiated with Direct Post Video, Upload Video Draft, Direct Post Photo, or Upload Photo Draft. Use the publishId returned from the post request to track progress.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'tiktok',
    requiredScopes: ['video.publish', 'video.upload'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'TikTok OAuth access token',
    },
    publishId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The publish ID returned from a post/upload tool.',
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
      publish_id: params.publishId.trim(),
    }),
  },

  transformResponse: async (response: Response): Promise<TikTokGetPostStatusResponse> => {
    /** TikTok's int64 post IDs must be extracted before JSON parsing rounds them. */
    const {
      data: statusData,
      error,
      rawBody,
    } = await readTikTokApiResponse(response, tiktokPostStatusApiDataSchema)
    const postIdsMatch = rawBody.match(/"publicaly_available_post_id"\s*:\s*\[([^\]]*)\]/)
    const publiclyAvailablePostId = postIdsMatch
      ? postIdsMatch[1]
          .split(',')
          .map((id: string) => id.trim().replace(/^"|"$/g, ''))
          .filter(Boolean)
      : []

    if (error) {
      return {
        success: false,
        output: emptyPostStatusOutput(),
        error: error.message || 'Failed to fetch post status',
      }
    }

    if (!statusData) {
      return {
        success: false,
        output: emptyPostStatusOutput(),
        error: 'No status data returned',
      }
    }

    return {
      success: true,
      output: {
        status: statusData.status ?? '',
        failReason: statusData.fail_reason ?? null,
        publiclyAvailablePostId,
        uploadedBytes: statusData.uploaded_bytes ?? null,
        downloadedBytes: statusData.downloaded_bytes ?? null,
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description:
        'Current status of the post. Values: PROCESSING_UPLOAD/PROCESSING_DOWNLOAD (TikTok is processing the media), SEND_TO_USER_INBOX (draft delivered, awaiting user action), PUBLISH_COMPLETE (successfully posted), FAILED (check failReason).',
    },
    failReason: {
      type: 'string',
      description: 'Reason for failure if status is FAILED. Null otherwise.',
      optional: true,
    },
    publiclyAvailablePostId: {
      type: 'array',
      description:
        'Array of public post IDs (as strings) once the content is published and publicly viewable. Can be used to construct the TikTok post URL.',
      items: {
        type: 'string',
        description: 'Public TikTok post ID',
      },
    },
    uploadedBytes: {
      type: 'number',
      description: 'Number of bytes uploaded to TikTok for FILE_UPLOAD posts',
      optional: true,
    },
    downloadedBytes: {
      type: 'number',
      description: 'Number of bytes TikTok downloaded for PULL_FROM_URL posts',
      optional: true,
    },
  },
}
