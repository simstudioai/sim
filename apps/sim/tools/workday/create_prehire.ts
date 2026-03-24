import type { ToolConfig } from '@/tools/types'
import type {
  WorkdayCreatePrehireParams,
  WorkdayCreatePrehireResponse,
} from '@/tools/workday/types'

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
    countryCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 3166-1 Alpha-2 country code (defaults to US)',
    },
  },

  request: {
    url: '/api/tools/workday/create-prehire',
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
