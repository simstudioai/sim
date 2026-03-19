import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { WorkdayChangeJobParams, WorkdayChangeJobResponse } from '@/tools/workday/types'
import { buildWorkdayBaseUrl, createWorkdayAuthHeader } from '@/tools/workday/utils'

const logger = createLogger('WorkdayChangeJobTool')

export const changeJobTool: ToolConfig<WorkdayChangeJobParams, WorkdayChangeJobResponse> = {
  id: 'workday_change_job',
  name: 'Change Workday Job',
  description:
    'Perform a job change for a worker including transfers, promotions, demotions, and lateral moves.',
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
      description: 'Worker ID for the job change',
    },
    effectiveDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Effective date for the job change in ISO 8601 format (e.g., 2025-06-01)',
    },
    newPositionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New position ID (for transfers)',
    },
    newJobProfileId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New job profile ID (for role changes)',
    },
    newLocationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New work location ID (for relocations)',
    },
    newManagerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New manager worker ID (for reporting changes)',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for the job change (e.g., Promotion, Transfer, Reorganization)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = buildWorkdayBaseUrl(params.tenantUrl, params.tenant)
      return `${baseUrl}/workers/${params.workerId}/jobChanges`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: createWorkdayAuthHeader(params.username, params.password),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        effectiveDate: params.effectiveDate,
      }

      if (params.newPositionId) body.position = { id: params.newPositionId }
      if (params.newJobProfileId) body.jobProfile = { id: params.newJobProfileId }
      if (params.newLocationId) body.location = { id: params.newLocationId }
      if (params.newManagerId) body.manager = { id: params.newManagerId }
      if (params.reason) body.reason = params.reason

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
          effectiveDate: data.effectiveDate ?? null,
        },
      }
    } catch (error) {
      logger.error('Workday change job - Error processing response:', { error })
      throw error
    }
  },

  outputs: {
    eventId: {
      type: 'string',
      description: 'Job change event ID',
    },
    workerId: {
      type: 'string',
      description: 'Worker ID the job change was applied to',
    },
    effectiveDate: {
      type: 'string',
      description: 'Effective date of the job change',
    },
  },
}
