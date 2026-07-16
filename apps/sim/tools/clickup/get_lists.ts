import {
  CLICKUP_API_BASE_URL,
  CLICKUP_LIST_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpList,
} from '@/tools/clickup/shared'
import type { ClickUpGetListsParams, ClickUpListListResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupGetListsTool: ToolConfig<ClickUpGetListsParams, ClickUpListListResponse> = {
  id: 'clickup_get_lists',
  name: 'ClickUp Get Lists',
  description:
    'List the lists in a ClickUp folder, or the folderless lists in a space when a space ID is provided instead',
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
      description: 'ID of the folder to list lists from (provide this or spaceId)',
    },
    spaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the space to list folderless lists from (provide this or folderId)',
    },
    archived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return archived lists',
    },
  },

  request: {
    url: (params) => {
      const base = params.folderId
        ? `${CLICKUP_API_BASE_URL}/folder/${encodeURIComponent(params.folderId)}/list`
        : params.spaceId
          ? `${CLICKUP_API_BASE_URL}/space/${encodeURIComponent(params.spaceId)}/list`
          : null

      if (!base) {
        throw new Error('Either a folder ID or a space ID is required to get lists')
      }

      const url = new URL(base)
      if (params.archived !== undefined) url.searchParams.set('archived', String(params.archived))
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
      const error = extractClickUpErrorMessage(response, data, 'Failed to get lists')
      return { success: false, output: { error }, error }
    }

    const rawLists = Array.isArray(data?.lists) ? data.lists : []

    return {
      success: true,
      output: { lists: rawLists.map((list: unknown) => mapClickUpList(list)) },
    }
  },

  outputs: {
    lists: {
      type: 'array',
      description: 'Lists in the folder or space',
      optional: true,
      items: {
        type: 'object',
        properties: CLICKUP_LIST_OUTPUT_PROPERTIES,
      },
    },
  },
}
