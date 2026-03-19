import type { ToolConfig } from '@/tools/types'
import type { WorkdayChangeJobParams, WorkdayChangeJobResponse } from '@/tools/workday/types'

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
    newSupervisoryOrgId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Target supervisory organization ID (for org transfers)',
    },
    reason: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reason for the job change (e.g., Promotion, Transfer, Reorganization)',
    },
  },

  request: {
    url: '/api/tools/workday/change-job',
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
