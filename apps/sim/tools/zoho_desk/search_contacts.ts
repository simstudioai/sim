import type { ToolConfig } from '@/tools/types'
import {
  projectZohoDeskResource,
  readZohoDeskList,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type {
  ZohoDeskSearchContactsParams,
  ZohoDeskSearchContactsResponse,
} from '@/tools/zoho_desk/types'
import { ZOHO_DESK_CONTACT_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  normalizeZohoDeskCommaList,
} from '@/tools/zoho_desk/utils'

export const zohoDeskSearchContactsTool: ToolConfig<
  ZohoDeskSearchContactsParams,
  ZohoDeskSearchContactsResponse
> = {
  id: 'zoho_desk_search_contacts',
  name: 'Zoho Desk Search Contacts',
  description: 'Search Contacts in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    searchEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Email ID of the contact. Supports * wildcards. Supports empty/not-empty search operators. Comma-separated values.',
    },
    searchPhone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Phone number of the contact. Supports * wildcards. Supports empty/not-empty search operators. Comma-separated values.',
    },
    searchMobile: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Mobile number of the contact. Supports * wildcards. Supports empty/not-empty search operators. Comma-separated values.',
    },
    searchAccountName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Name of the account associated with the Contact. Supports * wildcards. Supports empty/not-empty search operators.',
    },
    createdTimeRange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Key that filters contacts created in a particular period of time. Enter the from and to dates in the ISO date format of yyyy-MM-ddThh:mm:ss.SSSZ; For example, createdTimeRange=2017-11-05T00:00:00.000Z,2018-09-05T23:59:00.000Z',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size (1-100; default 10).',
    },
    from: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination start index (0-999; search returns at most the first 1000 matches).',
    },
    modifiedTimeRange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Key that filters contacts modified in a particular period of time. Enter the from and to dates in the ISO date format of yyyy-MM-ddThh:mm:ss.SSSZ; For example, modifiedTimeRange=2017-11-05T00:00:00.000Z,2018-09-05T23:59:00.000Z',
    },
    contactSearchIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the contact. Exact match. Comma-separated values.',
    },
    _all: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search text across all fields. Supports * wildcards; at least 3 characters.',
    },
    contactSearchCustomField1: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.`,
    },
    contactSearchCustomField2: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.`,
    },
    contactSearchCustomField3: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    contactSearchCustomField4: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    contactSearchCustomField5: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    contactSearchCustomField6: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    contactSearchCustomField7: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    contactSearchCustomField8: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    contactSearchCustomField9: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    contactSearchCustomField10: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchLastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name of the contact. Supports * wildcards.',
    },
    searchFirstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'First name of the contact. Supports * wildcards. Supports empty/not-empty search operators.',
    },
    fullName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full name of the contact. Supports * wildcards.',
    },
    contactSearchSortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort field: relevance, modifiedTime, createdTime, lastName, firstName. Prefix with - for descending.',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams({ from: String(params.from ?? 0) })
      if (params.searchEmail != null && params.searchEmail !== '') {
        const value = normalizeZohoDeskCommaList(params.searchEmail)
        if (value !== undefined) query.set('email', String(value))
      }
      if (params.searchPhone != null && params.searchPhone !== '') {
        const value = normalizeZohoDeskCommaList(params.searchPhone)
        if (value !== undefined) query.set('phone', String(value))
      }
      if (params.searchMobile != null && params.searchMobile !== '') {
        const value = normalizeZohoDeskCommaList(params.searchMobile)
        if (value !== undefined) query.set('mobile', String(value))
      }
      if (params.searchAccountName != null && params.searchAccountName !== '') {
        query.set('accountName', String(params.searchAccountName))
      }
      if (params.createdTimeRange != null && params.createdTimeRange !== '') {
        query.set('createdTimeRange', String(params.createdTimeRange))
      }
      if (params.limit != null) {
        const value = Number(params.limit)
        if (!Number.isInteger(value) || value < 1 || value > 100)
          throw new Error('limit is outside the documented range')
        query.set('limit', String(value))
      }
      if (params.from != null) {
        const value = Number(params.from)
        if (!Number.isInteger(value) || value < 0 || value > 999)
          throw new Error('from is outside the documented range')
        query.set('from', String(value))
      }
      if (params.modifiedTimeRange != null && params.modifiedTimeRange !== '') {
        query.set('modifiedTimeRange', String(params.modifiedTimeRange))
      }
      if (params.contactSearchIds != null && params.contactSearchIds !== '') {
        const value = normalizeZohoDeskCommaList(params.contactSearchIds)
        if (value !== undefined) query.set('id', String(value))
      }
      if (params._all != null && params._all !== '') {
        query.set('_all', String(params._all))
      }
      if (params.contactSearchCustomField1 != null && params.contactSearchCustomField1 !== '') {
        query.set('customField1', String(params.contactSearchCustomField1))
      }
      if (params.contactSearchCustomField2 != null && params.contactSearchCustomField2 !== '') {
        query.set('customField2', String(params.contactSearchCustomField2))
      }
      if (params.contactSearchCustomField3 != null && params.contactSearchCustomField3 !== '') {
        query.set('customField3', String(params.contactSearchCustomField3))
      }
      if (params.contactSearchCustomField4 != null && params.contactSearchCustomField4 !== '') {
        query.set('customField4', String(params.contactSearchCustomField4))
      }
      if (params.contactSearchCustomField5 != null && params.contactSearchCustomField5 !== '') {
        query.set('customField5', String(params.contactSearchCustomField5))
      }
      if (params.contactSearchCustomField6 != null && params.contactSearchCustomField6 !== '') {
        query.set('customField6', String(params.contactSearchCustomField6))
      }
      if (params.contactSearchCustomField7 != null && params.contactSearchCustomField7 !== '') {
        query.set('customField7', String(params.contactSearchCustomField7))
      }
      if (params.contactSearchCustomField8 != null && params.contactSearchCustomField8 !== '') {
        query.set('customField8', String(params.contactSearchCustomField8))
      }
      if (params.contactSearchCustomField9 != null && params.contactSearchCustomField9 !== '') {
        query.set('customField9', String(params.contactSearchCustomField9))
      }
      if (params.contactSearchCustomField10 != null && params.contactSearchCustomField10 !== '') {
        query.set('customField10', String(params.contactSearchCustomField10))
      }
      if (params.searchLastName != null && params.searchLastName !== '') {
        query.set('lastName', String(params.searchLastName))
      }
      if (params.searchFirstName != null && params.searchFirstName !== '') {
        query.set('firstName', String(params.searchFirstName))
      }
      if (params.fullName != null && params.fullName !== '') {
        query.set('fullName', String(params.fullName))
      }
      if (params.contactSearchSortBy != null && params.contactSearchSortBy !== '') {
        query.set('sortBy', String(params.contactSearchSortBy))
      }
      return `${getZohoDeskApiBase(params)}/contacts/search${query.size ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: buildZohoDeskHeaders,
  },
  transformResponse: async (response, params) => {
    const { items, totalCount } = await readZohoDeskList(response)
    const nextIndex = Number(params?.from ?? 0) + items.length
    return {
      success: true,
      output: {
        contacts: items.map((item) => projectZohoDeskResource(item, ZOHO_DESK_CONTACT_PROPERTIES)),
        count: items.length,
        nextFrom:
          items.length && nextIndex <= 999 && (totalCount === null || nextIndex < totalCount)
            ? nextIndex
            : null,
        totalCount,
      },
    }
  },
  outputs: {
    contacts: {
      type: 'array',
      description: 'Search Contacts results',
      items: { type: 'object', properties: ZOHO_DESK_CONTACT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of results in this page' },
    nextFrom: {
      type: 'number',
      nullable: true,
      description:
        'Next search index; null for an empty page, a reached total, or the 1000-result search window. Narrow the filters to find further matches.',
    },
    totalCount: {
      type: 'number',
      nullable: true,
      description: 'Total search matches reported by Zoho, when provided',
    },
  },
}
