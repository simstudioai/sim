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
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of sessions to return (1-200, default: 100)',
      },
    },

    request: {
      url: (params) => {
        const searchParams = new URLSearchParams()
        if (params.limit) searchParams.set('first', String(params.limit))
        const qs = searchParams.toString()
        return `https://api.devin.ai/v3/organizations/sessions${qs ? `?${qs}` : ''}`
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
            tags: item.tags ?? null,
          })),
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
    },
  }
