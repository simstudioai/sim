import type { OneDriveShareLinkResponse, OneDriveToolParams } from '@/tools/onedrive/types'
import type { ToolConfig } from '@/tools/types'

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
  },

  request: {
    url: (params) =>
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(params.fileId || '')}/createLink`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      type: params.linkType || 'view',
      ...(params.linkScope && { scope: params.linkScope }),
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
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the sharing link was created successfully' },
    link: {
      type: 'object',
      description: 'The created sharing link, including its type, scope, and URL',
    },
  },
}
