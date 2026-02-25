import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioGetListParams, AttioGetListResponse } from './types'
import { LIST_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioGetList')

export const attioGetListTool: ToolConfig<AttioGetListParams, AttioGetListResponse> = {
  id: 'attio_get_list',
  name: 'Attio Get List',
  description: 'Get a single list by ID or slug',
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
    list: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The list ID or slug',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/lists/${params.list}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to get list')
    }
    const list = data.data
    const actor = list.created_by_actor as { type?: string; id?: string } | undefined
    return {
      success: true,
      output: {
        listId: list.id?.list_id ?? null,
        apiSlug: list.api_slug ?? null,
        name: list.name ?? null,
        parentObject: Array.isArray(list.parent_object)
          ? (list.parent_object[0] ?? null)
          : (list.parent_object ?? null),
        workspaceAccess: list.workspace_access ?? null,
        workspaceMemberAccess: list.workspace_member_access ?? null,
        createdByActor: actor ? { type: actor.type ?? null, id: actor.id ?? null } : null,
        createdAt: list.created_at ?? null,
      },
    }
  },

  outputs: LIST_OUTPUT_PROPERTIES,
}
