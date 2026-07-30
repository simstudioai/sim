import type { OneDriveGetDriveInfoResponse, OneDriveToolParams } from '@/tools/onedrive/types'
import type { ToolConfig } from '@/tools/types'

export const getDriveInfoTool: ToolConfig<OneDriveToolParams, OneDriveGetDriveInfoResponse> = {
  id: 'onedrive_get_drive_info',
  name: 'Get OneDrive Info',
  description: 'Get information about the OneDrive drive, including storage quota',
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
  },

  request: {
    url: () => 'https://graph.microsoft.com/v1.0/me/drive',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        driveId: data.id,
        driveType: data.driveType,
        webUrl: data.webUrl,
        owner: data.owner?.user?.displayName ?? null,
        quota: {
          total: data.quota?.total ?? 0,
          used: data.quota?.used ?? 0,
          remaining: data.quota?.remaining ?? 0,
          deleted: data.quota?.deleted ?? 0,
          state: data.quota?.state ?? 'normal',
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the drive info was retrieved' },
    driveId: { type: 'string', description: 'The ID of the drive' },
    driveType: { type: 'string', description: 'The type of drive (e.g., "personal", "business")' },
    webUrl: { type: 'string', description: 'URL to the drive in the browser' },
    owner: { type: 'string', description: 'Display name of the drive owner', optional: true },
    quota: {
      type: 'object',
      description: 'Storage quota information in bytes (total, used, remaining, deleted, state)',
    },
  },
}
