import type { SharepointDeleteFileResponse, SharepointToolParams } from '@/tools/sharepoint/types'
import { optionalTrim } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteFileTool: ToolConfig<SharepointToolParams, SharepointDeleteFileResponse> = {
  id: 'sharepoint_delete_file',
  name: 'Delete SharePoint File',
  description: 'Delete a file (or folder) from a SharePoint document library',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'sharepoint',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the SharePoint API',
    },
    driveId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the document library (drive). Example: b!abc123def456',
    },
    driveItemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file (drive item) to delete',
    },
  },

  request: {
    url: (params) => {
      const driveId = optionalTrim(params.driveId)
      const driveItemId = optionalTrim(params.driveItemId)
      if (!driveId) throw new Error('driveId must be provided')
      if (!driveItemId) throw new Error('driveItemId must be provided')
      return `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(driveItemId)}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (_response: Response, params) => {
    return {
      success: true,
      output: {
        deleted: true,
        itemId: params?.driveItemId ?? '',
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the file was deleted' },
    itemId: { type: 'string', description: 'The ID of the deleted file' },
  },
}
