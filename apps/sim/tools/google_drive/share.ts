import type { GoogleDrivePermission, GoogleDriveToolParams } from '@/tools/google_drive/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

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
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://www.googleapis.com/drive/v3/files/${params.fileId?.trim()}/permissions`
      )
      url.searchParams.append('supportsAllDrives', 'true')
      if (params.transferOwnership) {
        url.searchParams.append('transferOwnership', 'true')
      }
      if (params.moveToNewOwnersRoot) {
        url.searchParams.append('moveToNewOwnersRoot', 'true')
      }
      if (params.sendNotification !== undefined) {
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
      },
    },
  },
}
