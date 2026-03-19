import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type {
  WorkdayTerminateWorkerParams,
  WorkdayTerminateWorkerResponse,
} from '@/tools/workday/types'
import { buildWorkdayBaseUrl, createWorkdayAuthHeader } from '@/tools/workday/utils'

const logger = createLogger('WorkdayTerminateWorkerTool')

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
    url: (params) => {
      const baseUrl = buildWorkdayBaseUrl(params.tenantUrl, params.tenant)
      return `${baseUrl}/workers/${params.workerId}/terminations`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: createWorkdayAuthHeader(params.username, params.password),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        terminationDate: params.terminationDate,
        reason: params.reason,
      }

      if (params.notificationDate) body.notificationDate = params.notificationDate
      if (params.lastDayOfWork) body.lastDayOfWork = params.lastDayOfWork

      return body
    },
  },

  transformResponse: async (response: Response) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        const error = data.error ?? data.errors?.[0]?.error ?? data
        throw new Error(typeof error === 'string' ? error : JSON.stringify(error))
      }

      return {
        success: true,
        output: {
          eventId: data.id ?? null,
          workerId: data.worker?.id ?? null,
          terminationDate: data.terminationDate ?? null,
        },
      }
    } catch (error) {
      logger.error('Workday terminate worker - Error processing response:', { error })
      throw error
    }
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
