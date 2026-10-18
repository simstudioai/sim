import type { ToolConfig } from '@/tools/types'
import { ZOHO_DESK_ACCOUNT_PROPERTIES } from '@/tools/zoho_desk/outputs'
import {
  projectZohoDeskResource,
  readZohoDeskList,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type {
  ZohoDeskSearchAccountsParams,
  ZohoDeskSearchAccountsResponse,
} from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  normalizeZohoDeskCommaList,
} from '@/tools/zoho_desk/utils'

export const zohoDeskSearchAccountsTool: ToolConfig<
  ZohoDeskSearchAccountsParams,
  ZohoDeskSearchAccountsResponse
> = {
  id: 'zoho_desk_search_accounts',
  name: 'Zoho Desk Search Accounts',
  description: 'Search Accounts in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    accountName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the account. Supports * wildcards.',
    },
    createdTimeRange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Key that filters accounts created in a particular period of time. Enter the from and to dates in the ISO date format of yyyy-MM-ddThh:mm:ss.SSSZ; For example, createdTimeRange=2017-11-05T00:00:00.000Z,2018-09-05T23:59:00.000Z',
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
        'Key that filters accounts modified in a particular period of time. Enter the from and to dates in the ISO date format of yyyy-MM-ddThh:mm:ss.SSSZ; For example, modifiedTimeRange=2017-11-05T00:00:00.000Z,2018-09-05T23:59:00.000Z',
    },
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the account. Exact match. Comma-separated values.',
    },
    _all: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search text across all fields. Supports * wildcards; at least 3 characters.',
    },
    customField1: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.`,
    },
    customField2: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.`,
    },
    customField3: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField4: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField5: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField6: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField7: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField8: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField9: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField10: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort field: relevance, modifiedTime, createdTime, accountName. Prefix with - for descending.',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams({ from: String(params.from ?? 0) })
      if (params.accountName != null && params.accountName !== '') {
        query.set('accountName', String(params.accountName))
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
      if (params.id != null && params.id !== '') {
        const value = normalizeZohoDeskCommaList(params.id)
        if (value !== undefined) query.set('id', String(value))
      }
      if (params._all != null && params._all !== '') {
        query.set('_all', String(params._all))
      }
      if (params.customField1 != null && params.customField1 !== '') {
        query.set('customField1', String(params.customField1))
      }
      if (params.customField2 != null && params.customField2 !== '') {
        query.set('customField2', String(params.customField2))
      }
      if (params.customField3 != null && params.customField3 !== '') {
        query.set('customField3', String(params.customField3))
      }
      if (params.customField4 != null && params.customField4 !== '') {
        query.set('customField4', String(params.customField4))
      }
      if (params.customField5 != null && params.customField5 !== '') {
        query.set('customField5', String(params.customField5))
      }
      if (params.customField6 != null && params.customField6 !== '') {
        query.set('customField6', String(params.customField6))
      }
      if (params.customField7 != null && params.customField7 !== '') {
        query.set('customField7', String(params.customField7))
      }
      if (params.customField8 != null && params.customField8 !== '') {
        query.set('customField8', String(params.customField8))
      }
      if (params.customField9 != null && params.customField9 !== '') {
        query.set('customField9', String(params.customField9))
      }
      if (params.customField10 != null && params.customField10 !== '') {
        query.set('customField10', String(params.customField10))
      }
      if (params.sortBy != null && params.sortBy !== '') {
        query.set('sortBy', String(params.sortBy))
      }
      return `${getZohoDeskApiBase(params)}/accounts/search${query.size ? `?${query}` : ''}`
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
        accounts: items.map((item) => projectZohoDeskResource(item, ZOHO_DESK_ACCOUNT_PROPERTIES)),
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
    accounts: {
      type: 'array',
      description: 'Search Accounts results',
      items: { type: 'object', properties: ZOHO_DESK_ACCOUNT_PROPERTIES },
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
