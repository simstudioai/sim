import type { GoogleDriveToolParams, GoogleDriveUser } from '@/tools/google_drive/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveGetAboutParams extends GoogleDriveToolParams {}

interface GoogleDriveGetAboutResponse extends ToolResponse {
  output: {
    user: GoogleDriveUser & {
      emailAddress: string
    }
    storageQuota: {
      limit: string | null
      usage: string
      usageInDrive: string
      usageInDriveTrash: string
    }
    canCreateDrives: boolean
    importFormats: Record<string, string[]>
    exportFormats: Record<string, string[]>
    maxUploadSize: string
  }
}

export const getAboutTool: ToolConfig<GoogleDriveGetAboutParams, GoogleDriveGetAboutResponse> = {
  id: 'google_drive_get_about',
  name: 'Get Google Drive Info',
  description:
    'Get information about the user and their Google Drive (storage quota, capabilities)',
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
  },

  request: {
    url: () => {
      const url = new URL('https://www.googleapis.com/drive/v3/about')
      url.searchParams.append(
        'fields',
        'user,storageQuota,canCreateDrives,importFormats,exportFormats,maxUploadSize'
      )
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to get Google Drive info')
    }

    return {
      success: true,
      output: {
        user: {
          displayName: data.user?.displayName ?? null,
          emailAddress: data.user?.emailAddress ?? '',
          photoLink: data.user?.photoLink ?? null,
          permissionId: data.user?.permissionId ?? null,
          me: data.user?.me ?? true,
        },
        storageQuota: {
          limit: data.storageQuota?.limit ?? null,
          usage: data.storageQuota?.usage ?? '0',
          usageInDrive: data.storageQuota?.usageInDrive ?? '0',
          usageInDriveTrash: data.storageQuota?.usageInDriveTrash ?? '0',
        },
        canCreateDrives: data.canCreateDrives ?? false,
        importFormats: data.importFormats ?? {},
        exportFormats: data.exportFormats ?? {},
        maxUploadSize: data.maxUploadSize ?? '0',
      },
    }
  },

  outputs: {
    user: {
      type: 'json',
      description: 'Information about the authenticated user',
      properties: {
        displayName: { type: 'string', description: 'User display name' },
        emailAddress: { type: 'string', description: 'User email address' },
        photoLink: { type: 'string', description: 'URL to user profile photo', optional: true },
        permissionId: { type: 'string', description: 'User permission ID' },
        me: { type: 'boolean', description: 'Whether this is the authenticated user' },
      },
    },
    storageQuota: {
      type: 'json',
      description: 'Storage quota information in bytes',
      properties: {
        limit: {
          type: 'string',
          description: 'Total storage limit in bytes (null for unlimited)',
          optional: true,
        },
        usage: { type: 'string', description: 'Total storage used in bytes' },
        usageInDrive: { type: 'string', description: 'Storage used by Drive files in bytes' },
        usageInDriveTrash: {
          type: 'string',
          description: 'Storage used by trashed files in bytes',
        },
      },
    },
    canCreateDrives: {
      type: 'boolean',
      description: 'Whether user can create shared drives',
    },
    importFormats: {
      type: 'json',
      description: 'Map of MIME types that can be imported and their target formats',
    },
    exportFormats: {
      type: 'json',
      description: 'Map of Google Workspace MIME types and their exportable formats',
    },
    maxUploadSize: {
      type: 'string',
      description: 'Maximum upload size in bytes',
    },
  },
}
