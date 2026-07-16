import type {
  InstagramGetContainerStatusParams,
  InstagramGetContainerStatusResponse,
} from '@/tools/instagram/types'
import {
  bearerHeaders,
  graphUrl,
  idString,
  readGraphError,
  readGraphJson,
} from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramGetContainerStatusTool: ToolConfig<
  InstagramGetContainerStatusParams,
  InstagramGetContainerStatusResponse
> = {
  id: 'instagram_get_container_status',
  name: 'Instagram Get Container Status',
  description: 'Check the publishing status of a media container',
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
    containerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Media container id returned from a create/publish step',
    },
  },

  request: {
    url: (params) => graphUrl(`/${params.containerId.trim()}`, { fields: 'status_code,status' }),
    method: 'GET',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response, params): Promise<InstagramGetContainerStatusResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: {
          containerId: params?.containerId ?? '',
          statusCode: null,
          status: null,
        },
        error: await readGraphError(response),
      }
    }

    const data = await readGraphJson<{
      id?: string | number
      status_code?: string
      status?: string
    }>(response, 'Instagram container status response')
    return {
      success: true,
      output: {
        containerId: params?.containerId ?? idString(data.id) ?? '',
        statusCode: data.status_code ?? null,
        status: data.status ?? null,
      },
    }
  },

  outputs: {
    containerId: { type: 'string', description: 'Container id' },
    statusCode: {
      type: 'string',
      description: 'EXPIRED, ERROR, FINISHED, IN_PROGRESS, or PUBLISHED',
      optional: true,
    },
    status: {
      type: 'string',
      description: 'Detailed status message when available',
      optional: true,
    },
  },
}
