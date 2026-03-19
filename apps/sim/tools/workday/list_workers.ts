import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { WorkdayListWorkersParams, WorkdayListWorkersResponse } from '@/tools/workday/types'
import { buildWorkdayBaseUrl, createWorkdayAuthHeader } from '@/tools/workday/utils'

const logger = createLogger('WorkdayListWorkersTool')

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
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter workers by name or ID',
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
    url: (params) => {
      const baseUrl = buildWorkdayBaseUrl(params.tenantUrl, params.tenant)
      const queryParams = new URLSearchParams()

      if (params.search) queryParams.append('search', params.search)
      if (params.limit) queryParams.append('limit', params.limit.toString())
      if (params.offset) queryParams.append('offset', params.offset.toString())

      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}/workers?${queryString}` : `${baseUrl}/workers`
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

      const workers = Array.isArray(data.data) ? data.data : (data.workers ?? [])

      return {
        success: true,
        output: {
          workers: workers.map((w: Record<string, unknown>) => ({
            id: w.id ?? null,
            descriptor: w.descriptor ?? null,
            primaryWorkEmail: w.primaryWorkEmail ?? null,
            primaryWorkPhone: w.primaryWorkPhone ?? null,
            businessTitle: w.businessTitle ?? null,
            supervisoryOrganization:
              (w.supervisoryOrganization as Record<string, unknown>)?.descriptor ?? null,
            hireDate: w.hireDate ?? null,
            workerType: (w.workerType as Record<string, unknown>)?.descriptor ?? null,
            isActive: w.isActive ?? null,
          })),
          total: data.total ?? workers.length,
        },
      }
    } catch (error) {
      logger.error('Workday list workers - Error processing response:', { error })
      throw error
    }
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
