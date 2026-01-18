import type { GoogleDrivePermission, GoogleDriveToolParams } from '@/tools/google_drive/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveListPermissionsParams extends GoogleDriveToolParams {
  fileId: string
}

interface GoogleDriveListPermissionsResponse extends ToolResponse {
  output: {
    permissions: GoogleDrivePermission[]
    nextPageToken?: string
  }
}

export const listPermissionsTool: ToolConfig<
  GoogleDriveListPermissionsParams,
  GoogleDriveListPermissionsResponse
> = {
  id: 'google_drive_list_permissions',
  name: 'List Google Drive Permissions',
  description: 'List all permissions (who has access) for a file in Google Drive',
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
      description: 'The ID of the file to list permissions for',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://www.googleapis.com/drive/v3/files/${params.fileId?.trim()}/permissions`
      )
      url.searchParams.append('supportsAllDrives', 'true')
      url.searchParams.append(
        'fields',
        'nextPageToken,permissions(id,type,role,emailAddress,displayName,photoLink,domain,expirationTime,deleted,allowFileDiscovery,pendingOwner,permissionDetails)'
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
      throw new Error(data.error?.message || 'Failed to list Google Drive permissions')
    }

    const permissions = (data.permissions ?? []).map((p: Record<string, unknown>) => ({
      id: p.id ?? null,
      type: p.type ?? null,
      role: p.role ?? null,
      emailAddress: p.emailAddress ?? null,
      displayName: p.displayName ?? null,
      photoLink: p.photoLink ?? null,
      domain: p.domain ?? null,
      expirationTime: p.expirationTime ?? null,
      deleted: p.deleted ?? false,
      allowFileDiscovery: p.allowFileDiscovery ?? null,
      pendingOwner: p.pendingOwner ?? false,
      permissionDetails: p.permissionDetails ?? null,
    }))

    return {
      success: true,
      output: {
        permissions,
        nextPageToken: data.nextPageToken,
      },
    }
  },

  outputs: {
    permissions: {
      type: 'array',
      description: 'List of permissions on the file',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Permission ID (use to remove permission)' },
          type: { type: 'string', description: 'Grantee type (user, group, domain, anyone)' },
          role: {
            type: 'string',
            description:
              'Permission role (owner, organizer, fileOrganizer, writer, commenter, reader)',
          },
          emailAddress: { type: 'string', description: 'Email of the grantee' },
          displayName: { type: 'string', description: 'Display name of the grantee' },
          photoLink: { type: 'string', description: 'Photo URL of the grantee' },
          domain: { type: 'string', description: 'Domain of the grantee' },
          expirationTime: { type: 'string', description: 'When permission expires' },
          deleted: { type: 'boolean', description: 'Whether grantee account is deleted' },
          allowFileDiscovery: {
            type: 'boolean',
            description: 'Whether file is discoverable by grantee',
          },
          pendingOwner: { type: 'boolean', description: 'Whether ownership transfer is pending' },
          permissionDetails: {
            type: 'json',
            description: 'Details about inherited permissions',
          },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of permissions',
    },
  },
}
