import { createLogger } from '@sim/logger'
import type { OneDriveCopyResponse, OneDriveToolParams } from '@/tools/onedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OneDriveCopyTool')

/**
 * Microsoft Graph processes driveItem copies asynchronously: a successful request returns
 * `202 Accepted` with a `Location` header pointing to a monitor URL, not the copied item itself.
 * See https://learn.microsoft.com/en-us/graph/api/driveitem-copy
 */
export const copyTool: ToolConfig<OneDriveToolParams, OneDriveCopyResponse> = {
  id: 'onedrive_copy',
  name: 'Copy OneDrive File',
  description: 'Copy a file or folder to another location within OneDrive',
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
      description: 'The ID of the file or folder to copy',
    },
    destinationFolderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the destination parent folder',
    },
    destinationFileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional new name for the copy (defaults to the original name)',
    },
  },

  request: {
    url: (params) =>
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(params.fileId || '')}/copy`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      parentReference: { id: params.destinationFolderId },
      ...(params.destinationFileName && { name: params.destinationFileName }),
    }),
  },

  transformResponse: async (response: Response, params?: OneDriveToolParams) => {
    if (response.status !== 202) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error?.message || 'Failed to start OneDrive copy')
    }

    const monitorUrl = response.headers.get('location') || undefined

    logger.info('OneDrive copy accepted for async processing', {
      fileId: params?.fileId,
      monitorUrl,
    })

    return {
      success: true,
      output: {
        sourceFileId: params?.fileId || '',
        name: params?.destinationFileName,
        monitorUrl,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the copy request was accepted' },
    sourceFileId: { type: 'string', description: 'The ID of the file or folder that was copied' },
    name: { type: 'string', description: 'The requested name for the copy, if provided' },
    monitorUrl: {
      type: 'string',
      description:
        'URL to poll for the status of the asynchronous copy operation (copy completes in the background)',
    },
  },
}
