import type { ToolConfig } from '@/tools/types'
import type { WorkdayUpdateWorkerParams, WorkdayUpdateWorkerResponse } from '@/tools/workday/types'

export const updateWorkerTool: ToolConfig<WorkdayUpdateWorkerParams, WorkdayUpdateWorkerResponse> =
  {
    id: 'workday_update_worker',
    name: 'Update Workday Worker',
    description: 'Update fields on an existing worker record in Workday.',
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
        description: 'Worker ID to update',
      },
      fields: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Fields to update as JSON (e.g., {"businessTitle": "Senior Engineer", "primaryWorkEmail": "new@company.com"})',
      },
    },

    request: {
      url: '/api/tools/workday/update-worker',
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
      eventId: {
        type: 'string',
        description: 'Event ID of the change personal information business process',
      },
      workerId: {
        type: 'string',
        description: 'Worker ID that was updated',
      },
    },
  }
