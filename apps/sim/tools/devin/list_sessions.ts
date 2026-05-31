import type { ToolConfig } from '@/tools/types'
import type { DevinListSessionsParams, DevinListSessionsResponse } from './types'
import { DEVIN_SESSION_LIST_ITEM_PROPERTIES } from './types'

export const devinListSessionsTool: ToolConfig<DevinListSessionsParams, DevinListSessionsResponse> =
  {
    id: 'devin_list_sessions',
    name: 'list_sessions',
    description: 'List Devin sessions in the organization. Returns up to 100 sessions by default.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Devin API key (service user credential starting with cog_)',
      },
      orgId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Devin organization ID (prefixed with org-)',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of sessions to return (1-200, default: 100)',
      },
      after: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Pagination cursor (endCursor from a previous response) to fetch the next page',
      },
    },

    request: {
      url: (params) => {
        const searchParams = new URLSearchParams()
        if (params.limit) searchParams.set('first', String(params.limit))
        if (params.after) searchParams.set('after', params.after.trim())
        const qs = searchParams.toString()
        return `https://api.devin.ai/v3/organizations/${params.orgId.trim()}/sessions${qs ? `?${qs}` : ''}`
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      const items = data.items ?? []
      return {
        success: true,
        output: {
          sessions: items.map((item: Record<string, unknown>) => ({
            sessionId: item.session_id ?? null,
            url: item.url ?? null,
            status: item.status ?? null,
            statusDetail: item.status_detail ?? null,
            title: item.title ?? null,
            createdAt: item.created_at ?? null,
            updatedAt: item.updated_at ?? null,
            tags: item.tags ?? [],
            acusConsumed: item.acus_consumed ?? null,
            pullRequests: item.pull_requests ?? [],
            playbookId: item.playbook_id ?? null,
            isArchived: item.is_archived ?? false,
          })),
          endCursor: data.end_cursor ?? null,
          hasNextPage: data.has_next_page ?? false,
          total: data.total ?? null,
        },
      }
    },

    outputs: {
      sessions: {
        type: 'array',
        description: 'List of Devin sessions',
        items: {
          type: 'object',
          properties: DEVIN_SESSION_LIST_ITEM_PROPERTIES,
        },
      },
      endCursor: {
        type: 'string',
        description: 'Pagination cursor for the next page, or null if last page',
        optional: true,
      },
      hasNextPage: {
        type: 'boolean',
        description: 'Whether more sessions are available',
      },
      total: {
        type: 'number',
        description: 'Total number of sessions, if provided',
        optional: true,
      },
    },
  }
