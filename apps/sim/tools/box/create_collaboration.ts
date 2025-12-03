import type {
  BoxCreateCollaborationParams,
  BoxCreateCollaborationResponse,
} from '@/tools/box/types'
import type { ToolConfig } from '@/tools/types'

export const boxCreateCollaborationTool: ToolConfig<
  BoxCreateCollaborationParams,
  BoxCreateCollaborationResponse
> = {
  id: 'box_create_collaboration',
  name: 'Box Create Collaboration',
  description: 'Share a file or folder with a user or group in Box',
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
      description: 'The ID of the file or folder to share',
    },
    itemType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The type of item: "file" or "folder"',
    },
    accessibleByLogin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address of the user to share with',
    },
    accessibleById: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the user or group to share with',
    },
    accessibleByType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of collaborator: "user" or "group"',
    },
    role: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Access role: "editor", "viewer", "previewer", "uploader", or "co-owner"',
    },
    canViewPath: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the collaborator can see the full path to the folder (folders only)',
    },
  },

  request: {
    url: 'https://api.box.com/2.0/collaborations',
    method: 'POST',
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
      const accessibleBy: Record<string, string> = {
        type: params.accessibleByType,
      }

      if (params.accessibleByLogin) {
        accessibleBy.login = params.accessibleByLogin
      } else if (params.accessibleById) {
        accessibleBy.id = params.accessibleById
      }

      const body: Record<string, unknown> = {
        item: {
          type: params.itemType,
          id: params.itemId,
        },
        accessible_by: accessibleBy,
        role: params.role,
      }

      if (params.canViewPath !== undefined && params.itemType === 'folder') {
        body.can_view_path = params.canViewPath
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message || data.error_description || 'Failed to create collaboration',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        collaboration: data,
      },
    }
  },

  outputs: {
    collaboration: {
      type: 'object',
      description: 'The created collaboration',
      properties: {
        id: { type: 'string', description: 'Collaboration ID' },
        role: { type: 'string', description: 'Access role' },
        status: { type: 'string', description: 'Collaboration status' },
        accessible_by: { type: 'object', description: 'User or group with access' },
        created_at: { type: 'string', description: 'Creation timestamp' },
      },
    },
  },
}
