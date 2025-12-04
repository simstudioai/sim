import type {
  DropboxCreateSharedLinkParams,
  DropboxCreateSharedLinkResponse,
} from '@/tools/dropbox/types'
import type { ToolConfig } from '@/tools/types'

export const dropboxCreateSharedLinkTool: ToolConfig<
  DropboxCreateSharedLinkParams,
  DropboxCreateSharedLinkResponse
> = {
  id: 'dropbox_create_shared_link',
  name: 'Dropbox Create Shared Link',
  description: 'Create a shareable link for a file or folder in Dropbox',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'dropbox',
  },

  params: {
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The path of the file or folder to share',
    },
    requestedVisibility: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Visibility: public, team_only, or password',
    },
    linkPassword: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password for the shared link (only if visibility is password)',
    },
    expires: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Expiration date in ISO 8601 format (e.g., 2025-12-31T23:59:59Z)',
    },
  },

  request: {
    url: 'https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Dropbox API request')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const body: Record<string, any> = {
        path: params.path,
      }

      const settings: Record<string, any> = {}

      if (params.requestedVisibility) {
        settings.requested_visibility = { '.tag': params.requestedVisibility }
      }

      if (params.linkPassword) {
        settings.link_password = params.linkPassword
      }

      if (params.expires) {
        settings.expires = params.expires
      }

      if (Object.keys(settings).length > 0) {
        body.settings = settings
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      // Check if a shared link already exists
      if (data.error_summary?.includes('shared_link_already_exists')) {
        return {
          success: false,
          error:
            'A shared link already exists for this path. Use list_shared_links to get the existing link.',
          output: {},
        }
      }
      return {
        success: false,
        error: data.error_summary || data.error?.message || 'Failed to create shared link',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        sharedLink: data,
      },
    }
  },

  outputs: {
    sharedLink: {
      type: 'object',
      description: 'The created shared link',
      properties: {
        url: { type: 'string', description: 'The shared link URL' },
        name: { type: 'string', description: 'Name of the shared item' },
        path_lower: { type: 'string', description: 'Lowercase path of the shared item' },
        expires: { type: 'string', description: 'Expiration date if set' },
        link_permissions: {
          type: 'object',
          description: 'Permissions for the shared link',
        },
      },
    },
  },
}
