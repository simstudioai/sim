import type { GoogleDriveToolParams } from '@/tools/google_drive/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveUnshareParams extends GoogleDriveToolParams {
  fileId: string
  permissionId: string
}

interface GoogleDriveUnshareResponse extends ToolResponse {
  output: {
    removed: boolean
    fileId: string
    permissionId: string
  }
}

export const unshareTool: ToolConfig<GoogleDriveUnshareParams, GoogleDriveUnshareResponse> = {
  id: 'google_drive_unshare',
  name: 'Unshare Google Drive File',
  description: 'Remove a permission from a file (revoke access)',
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
      description: 'The ID of the file to modify permissions on',
    },
    permissionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the permission to remove (use list_permissions to find this)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://www.googleapis.com/drive/v3/files/${params.fileId?.trim()}/permissions/${params.permissionId?.trim()}`
      )
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
      throw new Error(data.error?.message || 'Failed to remove permission from Google Drive file')
    }

    return {
      success: true,
      output: {
        removed: true,
        fileId: params?.fileId ?? '',
        permissionId: params?.permissionId ?? '',
      },
    }
  },

  outputs: {
    removed: {
      type: 'boolean',
      description: 'Whether the permission was successfully removed',
    },
    fileId: {
      type: 'string',
      description: 'The ID of the file',
    },
    permissionId: {
      type: 'string',
      description: 'The ID of the removed permission',
    },
  },
}
