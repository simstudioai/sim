import type { OneDriveShareLinkResponse, OneDriveToolParams } from '@/tools/onedrive/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const createShareLinkTool: ToolConfig<OneDriveToolParams, OneDriveShareLinkResponse> = {
  id: 'onedrive_create_share_link',
  name: 'Create OneDrive Sharing Link',
  description: 'Create a view or edit sharing link for a OneDrive file or folder',
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
      description: 'The ID of the file or folder to share',
    },
    linkType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Type of link to create: "view" (read-only), "edit" (read-write), or "embed"',
    },
    linkScope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Who can use the link: "anonymous" (anyone), "organization" (tenant members), or "users" (specific people)',
    },
    expirationDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'When the link expires, in yyyy-MM-ddTHH:mm:ssZ format (e.g., "2026-12-31T23:59:59Z"). Omit for no expiration unless the organization enforces one',
    },
  },

  request: {
    url: (params) =>
      `https://graph.microsoft.com/v1.0/me/drive/items/${safeUrlPathSegment(params.fileId ?? '', 'fileId')}/createLink`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      type: params.linkType || 'view',
      ...(params.linkScope && { scope: params.linkScope }),
      ...(params.expirationDateTime?.trim() && {
        expirationDateTime: params.expirationDateTime.trim(),
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        link: {
          type: data.link?.type,
          scope: data.link?.scope,
          webUrl: data.link?.webUrl,
          webHtml: data.link?.webHtml,
          permissionId: data.id ?? null,
          roles: Array.isArray(data.roles) ? data.roles : [],
          hasPassword: data.hasPassword ?? null,
          expirationDateTime: data.expirationDateTime ?? null,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the sharing link was created successfully' },
    link: {
      type: 'object',
      description: 'The created sharing link, including its type, scope, and URL',
      properties: {
        type: { type: 'string', description: 'Link type (view, edit, or embed)' },
        scope: { type: 'string', description: 'Link scope', optional: true },
        webUrl: { type: 'string', description: 'The sharing URL' },
        webHtml: {
          type: 'string',
          description: 'Embeddable iframe HTML (embed links only)',
          optional: true,
        },
        permissionId: {
          type: 'string',
          description: 'ID of the permission that backs the link',
          optional: true,
        },
        roles: {
          type: 'array',
          description: 'Roles the link grants (e.g., read, write)',
          optional: true,
        },
        hasPassword: {
          type: 'boolean',
          description: 'Whether the link is password protected',
          optional: true,
        },
        expirationDateTime: {
          type: 'string',
          description: 'When the link expires, if it does',
          optional: true,
        },
      },
    },
  },
}
