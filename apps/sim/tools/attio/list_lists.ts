import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioListListsParams, AttioListListsResponse } from './types'
import { LIST_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioListLists')

export const attioListListsTool: ToolConfig<AttioListListsParams, AttioListListsResponse> = {
  id: 'attio_list_lists',
  name: 'Attio List Lists',
  description: 'List all lists in the Attio workspace',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'attio',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The OAuth access token for the Attio API',
    },
  },

  request: {
    url: 'https://api.attio.com/v2/lists',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to list lists')
    }
    const lists = (data.data ?? []).map((list: Record<string, unknown>) => {
      const id = list.id as { list_id?: string } | undefined
      const actor = list.created_by_actor as { type?: string; id?: string } | undefined
      return {
        listId: id?.list_id ?? null,
        apiSlug: (list.api_slug as string) ?? null,
        name: (list.name as string) ?? null,
        parentObject: Array.isArray(list.parent_object)
          ? (list.parent_object[0] ?? null)
          : ((list.parent_object as string) ?? null),
        workspaceAccess: (list.workspace_access as string) ?? null,
        workspaceMemberAccess: list.workspace_member_access ?? null,
        createdByActor: actor ? { type: actor.type ?? null, id: actor.id ?? null } : null,
        createdAt: (list.created_at as string) ?? null,
      }
    })
    return {
      success: true,
      output: {
        lists,
        count: lists.length,
      },
    }
  },

  outputs: {
    lists: {
      type: 'array',
      description: 'Array of lists',
      items: {
        type: 'object',
        properties: LIST_OUTPUT_PROPERTIES,
      },
    },
    count: { type: 'number', description: 'Number of lists returned' },
  },
}
