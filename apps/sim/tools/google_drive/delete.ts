import type { GoogleDriveToolParams } from '@/tools/google_drive/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveDeleteParams extends GoogleDriveToolParams {
  fileId: string
}

interface GoogleDriveDeleteResponse extends ToolResponse {
  output: {
    deleted: boolean
    fileId: string
  }
}

export const deleteTool: ToolConfig<GoogleDriveDeleteParams, GoogleDriveDeleteResponse> = {
  id: 'google_drive_delete',
  name: 'Delete Google Drive File',
  description: 'Permanently delete a file from Google Drive (bypasses trash)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-drive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file to permanently delete',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://www.googleapis.com/drive/v3/files/${params.fileId?.trim()}`)
      url.searchParams.append('supportsAllDrives', 'true')
      return url.toString()
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error?.message || 'Failed to delete Google Drive file')
    }

    return {
      success: true,
      output: {
        deleted: true,
        fileId: params?.fileId ?? '',
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the file was successfully deleted',
    },
    fileId: {
      type: 'string',
      description: 'The ID of the deleted file',
    },
  },
}
