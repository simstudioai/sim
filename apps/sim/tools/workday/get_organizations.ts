import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type {
  WorkdayGetOrganizationsParams,
  WorkdayGetOrganizationsResponse,
} from '@/tools/workday/types'
import { buildWorkdayBaseUrl, createWorkdayAuthHeader } from '@/tools/workday/utils'

const logger = createLogger('WorkdayGetOrganizationsTool')

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
    url: (params) => {
      const baseUrl = buildWorkdayBaseUrl(params.tenantUrl, params.tenant)
      const queryParams = new URLSearchParams()

      if (params.type) queryParams.append('type', params.type)
      if (params.limit) queryParams.append('limit', params.limit.toString())
      if (params.offset) queryParams.append('offset', params.offset.toString())

      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}/organizations?${queryString}` : `${baseUrl}/organizations`
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

      const organizations = Array.isArray(data.data) ? data.data : (data.organizations ?? [])

      return {
        success: true,
        output: {
          organizations: organizations.map((o: Record<string, unknown>) => ({
            id: o.id ?? null,
            descriptor: o.descriptor ?? null,
            type: (o.type as Record<string, unknown>)?.descriptor ?? o.type ?? null,
            subtype: (o.subtype as Record<string, unknown>)?.descriptor ?? o.subtype ?? null,
            isActive: o.isActive ?? null,
          })),
          total: data.total ?? organizations.length,
        },
      }
    } catch (error) {
      logger.error('Workday get organizations - Error processing response:', { error })
      throw error
    }
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
