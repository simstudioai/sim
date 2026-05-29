import type { ToolConfig } from '@/tools/types'
import type {
  ZoomInfoSearchContactsParams,
  ZoomInfoSearchContactsResponse,
} from '@/tools/zoominfo/types'
import {
  buildProxyBody,
  extractDataArray,
  extractPagination,
  paginationOutputProperties,
  toCsvStringOrUndefined,
  toNumberOrUndefined,
  transformZoomInfoEnvelope,
  ZOOMINFO_PROXY_URL,
} from '@/tools/zoominfo/utils'

export const zoominfoSearchContactsTool: ToolConfig<
  ZoomInfoSearchContactsParams,
  ZoomInfoSearchContactsResponse
> = {
  id: 'zoominfo_search_contacts',
  name: 'ZoomInfo Search Contacts',
  description:
    'Search ZoomInfo for contacts (people) by name, job title, company, and other filters. Does not return emails or phone numbers — use Enrich Contacts for engagement data.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ZoomInfo OAuth client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ZoomInfo OAuth client secret',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name',
    },
    fullName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full name',
    },
    emailAddress: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address',
    },
    jobTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job title',
    },
    managementLevel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Management level — JSON array or comma-separated list. Sent to the API as a comma-separated string.',
    },
    department: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Department — JSON array or comma-separated list. Sent to the API as a comma-separated string.',
    },
    companyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ZoomInfo company ID',
    },
    companyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name',
    },
    contactAccuracyScoreMin: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum accuracy score (70-99)',
    },
    requiredFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Fields that must exist in results — JSON array or comma-separated list. Sent to the API as a comma-separated string.',
    },
    excludePartialProfiles: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude partial profiles',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (1-based)',
    },
    rpp: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (1-100, default 25)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to sort by',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order (asc or desc)',
    },
  },

  request: {
    url: ZOOMINFO_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const attributes: Record<string, unknown> = {}
      if (params.firstName) attributes.firstName = params.firstName
      if (params.lastName) attributes.lastName = params.lastName
      if (params.fullName) attributes.fullName = params.fullName
      if (params.emailAddress) attributes.emailAddress = params.emailAddress
      if (params.jobTitle) attributes.jobTitle = params.jobTitle
      const managementLevel = toCsvStringOrUndefined(params.managementLevel, 'managementLevel')
      if (managementLevel) attributes.managementLevel = managementLevel
      const department = toCsvStringOrUndefined(params.department, 'department')
      if (department) attributes.department = department
      if (params.companyId) attributes.companyId = params.companyId
      if (params.companyName) attributes.companyName = params.companyName
      const minScore = toNumberOrUndefined(params.contactAccuracyScoreMin)
      if (minScore !== undefined) attributes.contactAccuracyScoreMin = String(minScore)
      const required = toCsvStringOrUndefined(params.requiredFields, 'requiredFields')
      if (required) attributes.requiredFields = required
      if (params.excludePartialProfiles !== undefined) {
        attributes.excludePartialProfiles = params.excludePartialProfiles
      }

      const query: Record<string, string | number> = {}
      const page = toNumberOrUndefined(params.page)
      const rpp = toNumberOrUndefined(params.rpp)
      if (page !== undefined) query['page[number]'] = page
      if (rpp !== undefined) query['page[size]'] = rpp
      if (params.sortBy) {
        const order = params.sortOrder === 'desc' ? '-' : ''
        query.sort = `${order}${params.sortBy}`
      }

      return {
        ...buildProxyBody(params),
        path: '/data/v1/contacts/search',
        method: 'POST',
        query: Object.keys(query).length > 0 ? query : undefined,
        body: {
          data: {
            type: 'ContactSearch',
            attributes,
          },
        },
      }
    },
  },

  transformResponse: async (response: Response) => {
    const { data } = await transformZoomInfoEnvelope(response)
    const contacts = extractDataArray(data)
    const pagination = extractPagination(data)
    return {
      success: true,
      output: {
        contacts,
        ...pagination,
      },
    }
  },

  outputs: {
    contacts: {
      type: 'array',
      description: 'Matching contacts (without emails or phone numbers)',
      items: { type: 'json' },
    },
    ...paginationOutputProperties,
  },
}
