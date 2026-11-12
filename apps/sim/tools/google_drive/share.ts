import type { GoogleDrivePermission, GoogleDriveToolParams } from '@/tools/google_drive/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

interface GoogleDriveShareParams extends GoogleDriveToolParams {
  fileId: string
  email?: string
  domain?: string
  type: 'user' | 'group' | 'domain' | 'anyone'
  role: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader'
  transferOwnership?: boolean
  moveToNewOwnersRoot?: boolean
  sendNotification?: boolean
  emailMessage?: string
  expirationTime?: string
  allowFileDiscovery?: boolean
}

interface GoogleDriveShareResponse extends ToolResponse {
  output: {
    permission: GoogleDrivePermission
  }
}

export const shareTool: ToolConfig<GoogleDriveShareParams, GoogleDriveShareResponse> = {
  id: 'google_drive_share',
  name: 'Share Google Drive File',
  description: 'Share a file with a user, group, domain, or make it public',
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
      description: 'The ID of the file to share',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of grantee: user, group, domain, or anyone',
    },
    role: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Permission role: owner (transfer ownership), organizer (shared drive only), fileOrganizer (shared drive only), writer (edit), commenter (view and comment), reader (view only)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address of the user or group (required for type=user or type=group)',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Domain to share with (required for type=domain)',
    },
    transferOwnership: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Required when role is owner. Transfers ownership to the specified user.',
    },
    moveToNewOwnersRoot: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        "When transferring ownership, move the file to the new owner's My Drive root folder.",
    },
    sendNotification: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to send an email notification (default: true)',
    },
    emailMessage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom message to include in the notification email',
    },
    expirationTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'RFC 3339 time when the permission expires (e.g., 2025-12-31T23:59:59Z). Only for user and group permissions; must be in the future and at most one year out',
    },
    allowFileDiscovery: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the file can be discovered through search. Only for domain and anyone permissions',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://www.googleapis.com/drive/v3/files/${safeUrlPathSegment(params.fileId, 'fileId')}/permissions`
      )
      url.searchParams.append('supportsAllDrives', 'true')
      url.searchParams.append(
        'fields',
        'id,type,role,emailAddress,displayName,domain,expirationTime,deleted,allowFileDiscovery,pendingOwner'
      )
      if (params.transferOwnership) {
        url.searchParams.append('transferOwnership', 'true')
      }
      if (params.transferOwnership && params.moveToNewOwnersRoot) {
        url.searchParams.append('moveToNewOwnersRoot', 'true')
      }
      if (params.transferOwnership) {
        url.searchParams.append('sendNotificationEmail', 'true')
      } else if (params.sendNotification !== undefined) {
        url.searchParams.append('sendNotificationEmail', String(params.sendNotification))
      }
      if (params.emailMessage) {
        url.searchParams.append('emailMessage', params.emailMessage)
      }
      return url.toString()
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        type: params.type,
        role: params.role,
      }
      if (params.email) {
        body.emailAddress = params.email.trim()
      }
      if (params.domain) {
        body.domain = params.domain.trim()
      }
      const expirationTime = params.expirationTime?.trim()
      if (expirationTime) {
        body.expirationTime = expirationTime
      }
      if (params.allowFileDiscovery !== undefined) {
        body.allowFileDiscovery = params.allowFileDiscovery
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to share Google Drive file')
    }

    return {
      success: true,
      output: {
        permission: {
          id: data.id ?? null,
          type: data.type ?? null,
          role: data.role ?? null,
          emailAddress: data.emailAddress ?? null,
          displayName: data.displayName ?? null,
          domain: data.domain ?? null,
          expirationTime: data.expirationTime ?? null,
          deleted: data.deleted ?? false,
          allowFileDiscovery: data.allowFileDiscovery ?? null,
          pendingOwner: data.pendingOwner ?? false,
        },
      },
    }
  },

  outputs: {
    permission: {
      type: 'json',
      description: 'The created permission details',
      properties: {
        id: { type: 'string', description: 'Permission ID' },
        type: { type: 'string', description: 'Grantee type (user, group, domain, anyone)' },
        role: { type: 'string', description: 'Permission role' },
        emailAddress: { type: 'string', description: 'Email of the grantee', optional: true },
        displayName: { type: 'string', description: 'Display name of the grantee', optional: true },
        domain: { type: 'string', description: 'Domain of the grantee', optional: true },
        expirationTime: { type: 'string', description: 'Expiration time', optional: true },
        deleted: { type: 'boolean', description: 'Whether grantee is deleted' },
        allowFileDiscovery: {
          type: 'boolean',
          description: 'Whether the file is discoverable through search (domain and anyone only)',
          optional: true,
        },
        pendingOwner: {
          type: 'boolean',
          description: 'Whether the grantee is a pending owner of the file',
          optional: true,
        },
      },
    },
  },
}
