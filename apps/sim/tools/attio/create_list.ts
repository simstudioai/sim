import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioCreateListParams, AttioCreateListResponse } from './types'
import { LIST_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioCreateList')

export const attioCreateListTool: ToolConfig<AttioCreateListParams, AttioCreateListResponse> = {
  id: 'attio_create_list',
  name: 'Attio Create List',
  description: 'Create a new list in Attio',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The list name',
    },
    apiSlug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The API slug for the list (auto-generated from name if omitted)',
    },
    parentObject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The parent object slug (e.g. people, companies)',
    },
    workspaceAccess: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Workspace-level access: full-access, read-and-write, or read-only (omit for private)',
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
    url: 'https://api.attio.com/v2/lists',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const apiSlug =
        params.apiSlug ||
        params.name
          ?.toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '')
      const data: Record<string, unknown> = {
        name: params.name,
        api_slug: apiSlug,
        parent_object: params.parentObject,
        workspace_access: params.workspaceAccess ?? null,
        workspace_member_access: [] as unknown[],
      }
      if (params.workspaceMemberAccess) {
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
      throw new Error(data.message || 'Failed to create list')
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
