import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { WorkdayUpdateWorkerParams, WorkdayUpdateWorkerResponse } from '@/tools/workday/types'
import { buildWorkdayBaseUrl, createWorkdayAuthHeader } from '@/tools/workday/utils'

const logger = createLogger('WorkdayUpdateWorkerTool')

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
      url: (params) => {
        const baseUrl = buildWorkdayBaseUrl(params.tenantUrl, params.tenant)
        return `${baseUrl}/workers/${params.workerId}`
      },
      method: 'PATCH',
      headers: (params) => ({
        Authorization: createWorkdayAuthHeader(params.username, params.password),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: (params) => {
        if (!params.fields || typeof params.fields !== 'object') {
          throw new Error('Fields must be a JSON object')
        }
        return params.fields
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
        logger.error('Workday update worker - Error processing response:', { error })
        throw error
      }
    },

    outputs: {
      worker: {
        type: 'json',
        description: 'Updated worker record',
      },
    },
  }
