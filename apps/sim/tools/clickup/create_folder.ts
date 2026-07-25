import {
  CLICKUP_API_BASE_URL,
  CLICKUP_FOLDER_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpFolder,
} from '@/tools/clickup/shared'
import type { ClickUpCreateFolderParams, ClickUpFolderResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupCreateFolderTool: ToolConfig<ClickUpCreateFolderParams, ClickUpFolderResponse> =
  {
    id: 'clickup_create_folder',
    name: 'ClickUp Create Folder',
    description: 'Create a new folder in a ClickUp space',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'clickup',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'OAuth access token or personal API token for ClickUp',
      },
      spaceId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the space to create the folder in',
      },
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Name of the folder',
      },
    },

    request: {
      url: (params) => `${CLICKUP_API_BASE_URL}/space/${encodeURIComponent(params.spaceId)}/folder`,
      method: 'POST',
      headers: (params) => ({
        Authorization: clickupAuthorizationHeader(params.accessToken),
        'Content-Type': 'application/json',
      }),
      body: (params) => ({ name: params.name }),
    },

    transformResponse: async (response) => {
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        const error = extractClickUpErrorMessage(response, data, 'Failed to create folder')
        return { success: false, output: { error }, error }
      }

      return {
        success: true,
        output: { folder: mapClickUpFolder(data) },
      }
    },

    outputs: {
      folder: {
        type: 'json',
        description: 'The created folder',
        optional: true,
        properties: CLICKUP_FOLDER_OUTPUT_PROPERTIES,
      },
    },
  }
