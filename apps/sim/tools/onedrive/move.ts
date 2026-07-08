import { createLogger } from '@sim/logger'
import type { OneDriveMoveResponse, OneDriveToolParams } from '@/tools/onedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OneDriveMoveTool')

export const moveTool: ToolConfig<OneDriveToolParams, OneDriveMoveResponse> = {
  id: 'onedrive_move',
  name: 'Move or Rename OneDrive File',
  description: 'Move a file or folder to a new parent folder, rename it, or both',
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
      description: 'The ID of the file or folder to move or rename',
    },
    destinationFolderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The ID of the destination parent folder (omit to only rename in place)',
    },
    newName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The new name for the file or folder (omit to only move)',
    },
  },

  request: {
    url: (params) =>
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(params.fileId || '')}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      if (!params.destinationFolderId && !params.newName) {
        throw new Error('Provide a destination folder, a new name, or both')
      }

      return {
        ...(params.destinationFolderId && {
          parentReference: { id: params.destinationFolderId },
        }),
        ...(params.newName && { name: params.newName }),
      }
    },
  },

  transformResponse: async (response: Response, params?: OneDriveToolParams) => {
    const data = await response.json()

    logger.info('Successfully moved/renamed OneDrive item', {
      fileId: params?.fileId,
      newName: data.name,
    })

    return {
      success: true,
      output: {
        file: {
          id: data.id,
          name: data.name,
          mimeType: data.file?.mimeType || (data.folder ? 'application/folder' : 'unknown'),
          webViewLink: data.webUrl,
          size: data.size?.toString(),
          createdTime: data.createdDateTime,
          modifiedTime: data.lastModifiedDateTime,
          parents: data.parentReference ? [data.parentReference.id] : [],
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the move or rename was successful' },
    file: {
      type: 'object',
      description: 'The updated file object with its new name and/or parent folder',
    },
  },
}
