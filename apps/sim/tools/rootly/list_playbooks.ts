import type { RootlyListPlaybooksParams, RootlyListPlaybooksResponse } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyListPlaybooksTool: ToolConfig<
  RootlyListPlaybooksParams,
  RootlyListPlaybooksResponse
> = {
  id: 'rootly_list_playbooks',
  name: 'Rootly List Playbooks',
  description: 'List playbooks from Rootly with pagination support.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rootly API key',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of items per page (default: 20)',
    },
    pageNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.pageSize) queryParams.set('page[size]', String(params.pageSize))
      if (params.pageNumber) queryParams.set('page[number]', String(params.pageNumber))
      const qs = queryParams.toString()
      return `https://api.rootly.com/v1/playbooks${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { playbooks: [], totalCount: 0 },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const playbooks = (data.data || []).map((item: Record<string, unknown>) => {
      const attrs = (item.attributes || {}) as Record<string, unknown>
      return {
        id: item.id ?? null,
        title: (attrs.title as string) ?? '',
        summary: (attrs.summary as string) ?? null,
        externalUrl: (attrs.external_url as string) ?? null,
        createdAt: (attrs.created_at as string) ?? '',
        updatedAt: (attrs.updated_at as string) ?? '',
      }
    })

    return {
      success: true,
      output: {
        playbooks,
        totalCount: data.meta?.total_count ?? playbooks.length,
      },
    }
  },

  outputs: {
    playbooks: {
      type: 'array',
      description: 'List of playbooks',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique playbook ID' },
          title: { type: 'string', description: 'Playbook title' },
          summary: { type: 'string', description: 'Playbook summary' },
          externalUrl: { type: 'string', description: 'External URL' },
          createdAt: { type: 'string', description: 'Creation date' },
          updatedAt: { type: 'string', description: 'Last update date' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of playbooks returned',
    },
  },
}
