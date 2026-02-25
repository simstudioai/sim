import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioUpdateListParams, AttioUpdateListResponse } from './types'
import { LIST_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioUpdateList')

export const attioUpdateListTool: ToolConfig<AttioUpdateListParams, AttioUpdateListResponse> = {
  id: 'attio_update_list',
  name: 'Attio Update List',
  description: 'Update a list in Attio',
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
      description: 'The list ID or slug to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the list',
    },
    apiSlug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New API slug for the list',
    },
    workspaceAccess: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New workspace-level access: full-access, read-and-write, or read-only (omit for private)',
    },
    workspaceMemberAccess: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of member access entries, e.g. [{"workspace_member_id":"...","level":"read-and-write"}]',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/lists/${params.list}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const data: Record<string, unknown> = {}
      if (params.name != null) data.name = params.name
      if (params.apiSlug != null) data.api_slug = params.apiSlug
      if (params.workspaceAccess != null) data.workspace_access = params.workspaceAccess
      if (params.workspaceMemberAccess != null) {
        try {
          data.workspace_member_access =
            typeof params.workspaceMemberAccess === 'string'
              ? JSON.parse(params.workspaceMemberAccess)
              : params.workspaceMemberAccess
        } catch {
          data.workspace_member_access = params.workspaceMemberAccess
        }
      }
      return { data }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to update list')
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
