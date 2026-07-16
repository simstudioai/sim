import {
  CLICKUP_API_BASE_URL,
  CLICKUP_LIST_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpList,
} from '@/tools/clickup/shared'
import type { ClickUpCreateListParams, ClickUpListResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupCreateListTool: ToolConfig<ClickUpCreateListParams, ClickUpListResponse> = {
  id: 'clickup_create_list',
  name: 'ClickUp Create List',
  description:
    'Create a new list in a ClickUp folder, or a folderless list in a space when a space ID is provided instead',
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
    folderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the folder to create the list in (provide this or spaceId)',
    },
    spaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the space to create a folderless list in (provide this or folderId)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the list',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plain text description of the list',
    },
    markdownContent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Markdown description of the list (use instead of content)',
    },
  },

  request: {
    url: (params) => {
      if (params.folderId) {
        return `${CLICKUP_API_BASE_URL}/folder/${encodeURIComponent(params.folderId)}/list`
      }
      if (params.spaceId) {
        return `${CLICKUP_API_BASE_URL}/space/${encodeURIComponent(params.spaceId)}/list`
      }
      throw new Error('Either a folder ID or a space ID is required to create a list')
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
      }

      if (params.content) body.content = params.content
      if (params.markdownContent) body.markdown_content = params.markdownContent

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to create list')
      return { success: false, output: { error }, error }
    }

    return {
      success: true,
      output: { list: mapClickUpList(data) },
    }
  },

  outputs: {
    list: {
      type: 'json',
      description: 'The created list',
      optional: true,
      properties: CLICKUP_LIST_OUTPUT_PROPERTIES,
    },
  },
}
