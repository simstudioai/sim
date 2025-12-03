import type { BoxCreateSharedLinkParams, BoxCreateSharedLinkResponse } from '@/tools/box/types'
import type { ToolConfig } from '@/tools/types'

export const boxCreateSharedLinkTool: ToolConfig<
  BoxCreateSharedLinkParams,
  BoxCreateSharedLinkResponse
> = {
  id: 'box_create_shared_link',
  name: 'Box Create Shared Link',
  description: 'Create a shared link for a file or folder in Box',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'box',
  },

  params: {
    itemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file or folder',
    },
    itemType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The type of item: "file" or "folder"',
    },
    access: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Access level: "open" (anyone), "company", or "collaborators"',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Password to protect the shared link',
    },
    unsharedAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expiration date in ISO 8601 format',
    },
    canDownload: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the link allows downloads',
    },
    canPreview: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the link allows previews',
    },
  },

  request: {
    url: (params) => `https://api.box.com/2.0/${params.itemType}s/${params.itemId}`,
    method: 'PUT',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Box API request')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const sharedLink: Record<string, unknown> = {}

      if (params.access) {
        sharedLink.access = params.access
      }
      if (params.password) {
        sharedLink.password = params.password
      }
      if (params.unsharedAt) {
        sharedLink.unshared_at = params.unsharedAt
      }

      // Always include permissions object with defaults (can_download: true, can_preview: true)
      // Box API requires explicit permissions for proper shared link creation
      sharedLink.permissions = {
        can_download: params.canDownload !== undefined ? params.canDownload : true,
        can_preview: params.canPreview !== undefined ? params.canPreview : true,
      }

      return {
        shared_link: sharedLink,
      }
    },
  },

  transformResponse: async (response, params) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message || data.error_description || 'Failed to create shared link',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        sharedLink: data.shared_link,
        itemId: data.id,
        itemType: params?.itemType,
      },
    }
  },

  outputs: {
    sharedLink: {
      type: 'object',
      description: 'The shared link details',
      properties: {
        url: { type: 'string', description: 'The shared link URL' },
        download_url: { type: 'string', description: 'Direct download URL' },
        access: { type: 'string', description: 'Access level' },
        is_password_enabled: { type: 'boolean', description: 'Whether password is enabled' },
      },
    },
    itemId: {
      type: 'string',
      description: 'The ID of the item',
    },
    itemType: {
      type: 'string',
      description: 'The type of item',
    },
  },
}
