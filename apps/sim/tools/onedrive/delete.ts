import { createLogger } from '@/lib/logs/console/logger'
import type { OneDriveDeleteResponse, OneDriveToolParams } from '@/tools/onedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OneDriveDeleteTool')

export const deleteTool: ToolConfig<OneDriveToolParams, OneDriveDeleteResponse> = {
  id: 'onedrive_delete',
  name: 'Delete File from OneDrive',
  description: 'Delete a file or folder from OneDrive',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'onedrive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the OneDrive API',
    },
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file or folder to delete',
    },
  },

  request: {
    url: (params) => {
      return `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(params.fileId || '')}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: OneDriveToolParams) => {
    if (response.status === 204) {
      logger.info('Successfully deleted file from OneDrive', {
        fileId: params?.fileId,
      })

      return {
        success: true,
        output: {
          fileId: params?.fileId || '',
          deleted: true,
        },
      }
    }

    // If not 204, try to parse error
    const data = await response.json().catch(() => ({}))
    const errorMessage = data.error?.message || 'Failed to delete file'

    logger.error('Failed to delete file from OneDrive', {
      fileId: params?.fileId,
      error: errorMessage,
    })

    throw new Error(errorMessage)
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the file was deleted successfully' },
    deleted: { type: 'boolean', description: 'Confirmation that the file was deleted' },
    fileId: { type: 'string', description: 'The ID of the deleted file' },
  },
}
