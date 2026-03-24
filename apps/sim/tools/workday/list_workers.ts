import type { ToolConfig } from '@/tools/types'
import type { WorkdayListWorkersParams, WorkdayListWorkersResponse } from '@/tools/workday/types'

export const listWorkersTool: ToolConfig<WorkdayListWorkersParams, WorkdayListWorkersResponse> = {
  id: 'workday_list_workers',
  name: 'List Workday Workers',
  description: 'List or search workers with optional filtering and pagination.',
  version: '1.0.0',

  params: {
    tenantUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Workday instance URL (e.g., https://wd5-impl-services1.workday.com)',
    },
    tenant: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Workday tenant name',
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Integration System User username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Integration System User password',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of workers to return (default: 20)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of records to skip for pagination',
    },
  },

  request: {
    url: '/api/tools/workday/list-workers',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => params,
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error ?? 'Workday API request failed')
    }
    return data
  },

  outputs: {
    workers: {
      type: 'array',
      description: 'Array of worker profiles',
    },
    total: {
      type: 'number',
      description: 'Total number of matching workers',
    },
  },
}
