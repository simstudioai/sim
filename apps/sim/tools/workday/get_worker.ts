import type { ToolConfig } from '@/tools/types'
import type { WorkdayGetWorkerParams, WorkdayGetWorkerResponse } from '@/tools/workday/types'

export const getWorkerTool: ToolConfig<WorkdayGetWorkerParams, WorkdayGetWorkerResponse> = {
  id: 'workday_get_worker',
  name: 'Get Workday Worker',
  description:
    'Retrieve a specific worker profile including personal, employment, and organization data.',
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
    workerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Worker ID to retrieve (e.g., 3aa5550b7fe348b98d7b5741afc65534)',
    },
  },

  request: {
    url: '/api/tools/workday/get-worker',
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
    worker: {
      type: 'json',
      description: 'Worker profile with personal, employment, and organization data',
    },
  },
}
