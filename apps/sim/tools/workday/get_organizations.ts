import type { ToolConfig } from '@/tools/types'
import type {
  WorkdayGetOrganizationsParams,
  WorkdayGetOrganizationsResponse,
} from '@/tools/workday/types'

export const getOrganizationsTool: ToolConfig<
  WorkdayGetOrganizationsParams,
  WorkdayGetOrganizationsResponse
> = {
  id: 'workday_get_organizations',
  name: 'Get Workday Organizations',
  description: 'Retrieve organizations, departments, and cost centers from Workday.',
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
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organization type filter (e.g., Supervisory, Cost_Center, Company, Region)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of organizations to return (default: 20)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of records to skip for pagination',
    },
  },

  request: {
    url: '/api/tools/workday/get-organizations',
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
    organizations: {
      type: 'array',
      description: 'Array of organization records',
    },
    total: {
      type: 'number',
      description: 'Total number of matching organizations',
    },
  },
}
