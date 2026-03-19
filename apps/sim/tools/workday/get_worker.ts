import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { WorkdayGetWorkerParams, WorkdayGetWorkerResponse } from '@/tools/workday/types'
import { buildWorkdayBaseUrl, createWorkdayAuthHeader } from '@/tools/workday/utils'

const logger = createLogger('WorkdayGetWorkerTool')

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
    url: (params) => {
      const baseUrl = buildWorkdayBaseUrl(params.tenantUrl, params.tenant)
      return `${baseUrl}/workers/${params.workerId}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: createWorkdayAuthHeader(params.username, params.password),
      Accept: 'application/json',
    }),
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
          worker: {
            id: data.id ?? null,
            descriptor: data.descriptor ?? null,
            primaryWorkEmail: data.primaryWorkEmail ?? null,
            primaryWorkPhone: data.primaryWorkPhone ?? null,
            businessTitle: data.businessTitle ?? null,
            supervisoryOrganization: data.supervisoryOrganization?.descriptor ?? null,
            hireDate: data.hireDate ?? null,
            workerType: data.workerType?.descriptor ?? null,
            isActive: data.isActive ?? null,
            ...data,
          },
        },
      }
    } catch (error) {
      logger.error('Workday get worker - Error processing response:', { error })
      throw error
    }
  },

  outputs: {
    worker: {
      type: 'json',
      description: 'Worker profile with personal, employment, and organization data',
    },
  },
}
