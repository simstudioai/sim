import type { ToolConfig } from '@/tools/types'
import type {
  WorkdayTerminateWorkerParams,
  WorkdayTerminateWorkerResponse,
} from '@/tools/workday/types'

export const terminateWorkerTool: ToolConfig<
  WorkdayTerminateWorkerParams,
  WorkdayTerminateWorkerResponse
> = {
  id: 'workday_terminate_worker',
  name: 'Terminate Workday Worker',
  description:
    'Initiate a worker termination in Workday. Triggers the Terminate Employee business process.',
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
      description: 'Worker ID to terminate',
    },
    terminationDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Termination date in ISO 8601 format (e.g., 2025-06-01)',
    },
    reason: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Termination reason (e.g., Resignation, End_of_Contract, Retirement)',
    },
    notificationDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date the termination was communicated in ISO 8601 format',
    },
    lastDayOfWork: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last day of work in ISO 8601 format (defaults to termination date)',
    },
  },

  request: {
    url: '/api/tools/workday/terminate',
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
      description: 'Termination event ID',
    },
    workerId: {
      type: 'string',
      description: 'Worker ID that was terminated',
    },
    terminationDate: {
      type: 'string',
      description: 'Effective termination date',
    },
  },
}
