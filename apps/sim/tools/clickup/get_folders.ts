import {
  CLICKUP_API_BASE_URL,
  CLICKUP_FOLDER_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpFolder,
} from '@/tools/clickup/shared'
import type { ClickUpFolderListResponse, ClickUpGetFoldersParams } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupGetFoldersTool: ToolConfig<ClickUpGetFoldersParams, ClickUpFolderListResponse> =
  {
    id: 'clickup_get_folders',
    name: 'ClickUp Get Folders',
    description: 'List the folders in a ClickUp space',
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
        description: 'ID of the space to list folders from',
      },
      archived: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Return archived folders',
      },
    },

    request: {
      url: (params) => {
        const url = new URL(
          `${CLICKUP_API_BASE_URL}/space/${encodeURIComponent(params.spaceId)}/folder`
        )
        if (params.archived !== undefined) {
          url.searchParams.set('archived', String(params.archived))
        }
        return url.toString()
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: clickupAuthorizationHeader(params.accessToken),
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        const error = extractClickUpErrorMessage(response, data, 'Failed to get folders')
        return { success: false, output: { error }, error }
      }

      const rawFolders = Array.isArray(data?.folders) ? data.folders : []

      return {
        success: true,
        output: { folders: rawFolders.map((folder: unknown) => mapClickUpFolder(folder)) },
      }
    },

    outputs: {
      folders: {
        type: 'array',
        description: 'Folders in the space',
        optional: true,
        items: {
          type: 'object',
          properties: CLICKUP_FOLDER_OUTPUT_PROPERTIES,
        },
      },
    },
  }
