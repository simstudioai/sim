import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { WorkdayHireEmployeeParams, WorkdayHireEmployeeResponse } from '@/tools/workday/types'
import { buildWorkdayBaseUrl, createWorkdayAuthHeader } from '@/tools/workday/utils'

const logger = createLogger('WorkdayHireEmployeeTool')

export const hireEmployeeTool: ToolConfig<WorkdayHireEmployeeParams, WorkdayHireEmployeeResponse> =
  {
    id: 'workday_hire_employee',
    name: 'Hire Workday Employee',
    description:
      'Hire a pre-hire into an employee position. Converts an applicant into an active employee record with position, start date, and manager assignment.',
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
      preHireId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Pre-hire (applicant) ID to convert into an employee',
      },
      positionId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Position ID to assign the new hire to',
      },
      hireDate: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Hire date in ISO 8601 format (e.g., 2025-06-01)',
      },
      jobProfileId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Job profile ID for the position',
      },
      locationId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Work location ID',
      },
      managerId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Manager worker ID for the reporting relationship',
      },
      employeeType: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Employee type (e.g., Regular, Temporary, Contractor)',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = buildWorkdayBaseUrl(params.tenantUrl, params.tenant)
        return `${baseUrl}/staffingEvents`
      },
      method: 'POST',
      headers: (params) => ({
        Authorization: createWorkdayAuthHeader(params.username, params.password),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: (params) => {
        const body: Record<string, unknown> = {
          type: 'HIRE',
          preHire: { id: params.preHireId },
          position: { id: params.positionId },
          hireDate: params.hireDate,
        }

        if (params.jobProfileId) body.jobProfile = { id: params.jobProfileId }
        if (params.locationId) body.location = { id: params.locationId }
        if (params.managerId) body.manager = { id: params.managerId }
        if (params.employeeType) body.employeeType = params.employeeType

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
            workerId: data.worker?.id ?? data.workerId ?? null,
            employeeId: data.employeeId ?? data.id ?? null,
            descriptor: data.descriptor ?? data.worker?.descriptor ?? null,
            hireDate: data.hireDate ?? null,
          },
        }
      } catch (error) {
        logger.error('Workday hire employee - Error processing response:', { error })
        throw error
      }
    },

    outputs: {
      workerId: {
        type: 'string',
        description: 'Worker ID of the newly hired employee',
      },
      employeeId: {
        type: 'string',
        description: 'Employee ID assigned to the new hire',
      },
      descriptor: {
        type: 'string',
        description: 'Display name of the hired employee',
      },
      hireDate: {
        type: 'string',
        description: 'Effective hire date',
      },
    },
  }
