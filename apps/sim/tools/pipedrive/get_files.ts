import { createLogger } from '@/lib/logs/console/logger'
import type { PipedriveGetFilesParams, PipedriveGetFilesResponse } from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveGetFiles')

export const pipedriveGetFilesTool: ToolConfig<PipedriveGetFilesParams, PipedriveGetFilesResponse> =
  {
    id: 'pipedrive_get_files',
    name: 'Get Files from Pipedrive',
    description: 'Retrieve files from Pipedrive with optional filters',
    version: '1.0.0',

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'The access token for the Pipedrive API',
      },
      deal_id: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Filter files by deal ID',
      },
      person_id: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Filter files by person ID',
      },
      org_id: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Filter files by organization ID',
      },
      limit: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Number of results to return (default: 100, max: 500)',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = 'https://api.pipedrive.com/v1/files'
        const queryParams = new URLSearchParams()

        if (params.deal_id) queryParams.append('deal_id', params.deal_id)
        if (params.person_id) queryParams.append('person_id', params.person_id)
        if (params.org_id) queryParams.append('org_id', params.org_id)
        if (params.limit) queryParams.append('limit', params.limit)

        const queryString = queryParams.toString()
        return queryString ? `${baseUrl}?${queryString}` : baseUrl
      },
      method: 'GET',
      headers: (params) => {
        if (!params.accessToken) {
          throw new Error('Access token is required')
        }

        return {
          Authorization: `Bearer ${params.accessToken}`,
          Accept: 'application/json',
        }
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.success) {
        logger.error('Pipedrive API request failed', { data })
        throw new Error(data.error || 'Failed to fetch files from Pipedrive')
      }

      const files = data.data || []

      return {
        success: true,
        output: {
          files,
          metadata: {
            operation: 'get_files' as const,
            totalItems: files.length,
          },
          success: true,
        },
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Operation success status' },
      output: {
        type: 'object',
        description: 'Files data',
        properties: {
          files: {
            type: 'array',
            description: 'Array of file objects from Pipedrive',
          },
          metadata: {
            type: 'object',
            description: 'Operation metadata',
          },
          success: { type: 'boolean', description: 'Operation success status' },
        },
      },
    },
  }
