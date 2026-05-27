import type {
  IroncladListWorkflowsParams,
  IroncladListWorkflowsResponse,
} from '@/tools/ironclad/types'
import type { ToolConfig } from '@/tools/types'

export const listWorkflowsTool: ToolConfig<
  IroncladListWorkflowsParams,
  IroncladListWorkflowsResponse
> = {
  id: 'ironclad_list_workflows',
  name: 'Ironclad List Workflows',
  description: 'List all workflows in Ironclad with pagination support.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'ironclad',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (starting from 0)',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (max 100)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://na1.ironcladapp.com/public/api/v1/workflows')
      if (params.page !== undefined) url.searchParams.set('page', String(params.page))
      if (params.perPage !== undefined) url.searchParams.set('perPage', String(params.perPage))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to list workflows')
    }

    const workflows = (data.list ?? []).map((w: Record<string, unknown>) => ({
      id: (w.id as string) ?? '',
      status: (w.status as string) ?? null,
      template: (w.template as string) ?? null,
      creator: (w.creator as string) ?? null,
    }))

    return {
      success: true,
      output: {
        workflows,
        page: data.page ?? 0,
        pageSize: data.pageSize ?? data.perPage ?? 20,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    workflows: { type: 'json', description: 'List of workflows' },
    page: { type: 'number', description: 'Current page number' },
    pageSize: { type: 'number', description: 'Number of results per page' },
    count: { type: 'number', description: 'Total number of workflows' },
  },
}
