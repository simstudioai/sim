import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type {
  WorkdayCreatePrehireParams,
  WorkdayCreatePrehireResponse,
} from '@/tools/workday/types'
import { buildWorkdayBaseUrl, createWorkdayAuthHeader } from '@/tools/workday/utils'

const logger = createLogger('WorkdayCreatePrehireTool')

export const createPrehireTool: ToolConfig<
  WorkdayCreatePrehireParams,
  WorkdayCreatePrehireResponse
> = {
  id: 'workday_create_prehire',
  name: 'Create Workday Pre-Hire',
  description:
    'Create a new pre-hire (applicant) record in Workday. This is typically the first step before hiring an employee.',
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
    legalName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full legal name of the pre-hire (e.g., "Jane Doe")',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address of the pre-hire',
    },
    phoneNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number of the pre-hire',
    },
    address: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Address of the pre-hire',
    },
    sourceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Recruiting source ID (e.g., referral, job board)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = buildWorkdayBaseUrl(params.tenantUrl, params.tenant)
      return `${baseUrl}/preHires`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: createWorkdayAuthHeader(params.username, params.password),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const nameParts = params.legalName.trim().split(/\s+/)
      const firstName = nameParts[0]
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : ''

      const body: Record<string, unknown> = {
        name: {
          firstName,
          lastName,
        },
      }

      if (params.email) {
        body.email = { emailAddress: params.email, usageType: 'WORK' }
      }
      if (params.phoneNumber) {
        body.phone = { phoneNumber: params.phoneNumber, usageType: 'WORK' }
      }
      if (params.address) {
        body.address = { formattedAddress: params.address }
      }
      if (params.sourceId) {
        body.source = { id: params.sourceId }
      }

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
          preHireId: data.id ?? null,
          descriptor: data.descriptor ?? null,
        },
      }
    } catch (error) {
      logger.error('Workday create pre-hire - Error processing response:', { error })
      throw error
    }
  },

  outputs: {
    preHireId: {
      type: 'string',
      description: 'ID of the created pre-hire record',
    },
    descriptor: {
      type: 'string',
      description: 'Display name of the pre-hire',
    },
  },
}
