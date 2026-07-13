import { getErrorMessage } from '@sim/utils/errors'
import {
  type InstagramDownloadMediaBody,
  instagramDownloadMediaResponseSchema,
} from '@/lib/api/contracts/tools/instagram'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  InstagramDownloadMediaParams,
  InstagramDownloadMediaResponse,
} from '@/tools/instagram/types'
import type { ToolConfig } from '@/tools/types'

const MAX_INTERNAL_RESPONSE_BYTES = 256 * 1024

function failureOutput(mediaId: string): InstagramDownloadMediaResponse['output'] {
  return {
    files: [],
    mediaId,
    mediaType: null,
    downloadedCount: 0,
  }
}

export const instagramDownloadMediaTool: ToolConfig<
  InstagramDownloadMediaParams,
  InstagramDownloadMediaResponse
> = {
  id: 'instagram_download_media',
  name: 'Instagram Download Media',
  description:
    'Download an Instagram image, video, Reel, story, or ordered carousel into canonical User Files for downstream file inputs',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'instagram',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Instagram API',
    },
    mediaId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Instagram media ID to download',
    },
    filename: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional filename override; carousel items receive an ordered suffix',
    },
  },

  request: {
    url: '/api/tools/instagram/download-media',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) =>
      ({
        accessToken: params.accessToken,
        mediaId: params.mediaId,
        filename: params.filename,
        workspaceId:
          typeof params._context?.workspaceId === 'string'
            ? params._context.workspaceId
            : undefined,
        workflowId:
          typeof params._context?.workflowId === 'string' ? params._context.workflowId : undefined,
        executionId:
          typeof params._context?.executionId === 'string'
            ? params._context.executionId
            : undefined,
      }) satisfies InstagramDownloadMediaBody,
  },

  transformResponse: async (response, params): Promise<InstagramDownloadMediaResponse> => {
    const mediaId = params?.mediaId?.trim() ?? ''

    try {
      const rawData = await readResponseJsonWithLimit<unknown>(response, {
        maxBytes: MAX_INTERNAL_RESPONSE_BYTES,
        label: 'Instagram download media response',
      })
      const parsed = instagramDownloadMediaResponseSchema.safeParse(rawData)

      if (!parsed.success) {
        return {
          success: false,
          output: failureOutput(mediaId),
          error: 'Instagram download route returned an invalid response',
        }
      }

      if (!response.ok || !parsed.data.success) {
        return {
          success: false,
          output: failureOutput(mediaId),
          error:
            parsed.data.success === false
              ? parsed.data.error
              : `Instagram download failed with status ${response.status}`,
        }
      }

      return {
        success: true,
        output: parsed.data.output,
      }
    } catch (error) {
      return {
        success: false,
        output: failureOutput(mediaId),
        error: getErrorMessage(error, 'Failed to read Instagram download response'),
      }
    }
  },

  outputs: {
    files: {
      type: 'file[]',
      description: 'Downloaded media as canonical User Files, ready for attachment inputs',
    },
    mediaId: { type: 'string', description: 'Instagram media ID that was downloaded' },
    mediaType: {
      type: 'string',
      description: 'Instagram media type, such as IMAGE, VIDEO, or CAROUSEL_ALBUM',
      optional: true,
    },
    downloadedCount: { type: 'number', description: 'Number of files downloaded' },
  },
}
