import type { InternalToolConfig } from '@/tools/types'
import type {
  ZoomInfoSearchContactsParams,
  ZoomInfoSearchContactsResponse,
} from '@/tools/zoominfo/types'
import {
  extractDataArray,
  extractPagination,
  paginationOutputProperties,
  transformZoomInfoResponse,
} from '@/tools/zoominfo/utils'

export const zoominfoSearchContactsTool: InternalToolConfig<
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

  operation: {
    input: (params) => params,
  },

  transformResponse: async (response: Response) => {
    const { data } = await transformZoomInfoResponse(response)
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
