import type { ToolConfig } from '@/tools/types'
import { ZOHO_DESK_DEPARTMENT_PROPERTIES } from '@/tools/zoho_desk/outputs'
import {
  projectZohoDeskResource,
  readZohoDeskList,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type {
  ZohoDeskListDepartmentsParams,
  ZohoDeskListDepartmentsResponse,
} from '@/tools/zoho_desk/types'
import { buildZohoDeskHeaders, getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

export const zohoDeskListDepartmentsTool: ToolConfig<
  ZohoDeskListDepartmentsParams,
  ZohoDeskListDepartmentsResponse
> = {
  id: 'zoho_desk_list_departments',
  name: 'Zoho Desk List Departments',
  description: 'List Departments in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    chatStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Key that filters departments based on their chat status. Values allowed are AVAILABLE, DISABLED, NOT_CREATED, and \${UNAVAILABLE}. \${UNAVAILABLE} refers to departments which are not available for chat.`,
    },
    searchStr: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'String to search for departments by name, help center name, or description. The string must contain at least one character. Three search methods are supported: 1) string* - Searches for departments whose name, help center name, or description start with the string, 2) *string* - Searches for departments whose name, help center name, or description contain the string, 3) string - Searches for departments whose name, help center name, or description is an. Exact match. for the string',
    },
    isEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Key that filters departments based on their enabled status',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size (0-200; default 10).',
    },
    from: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination start index (0-based).',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams({ from: String(params.from ?? 0) })
      if (params.chatStatus != null && params.chatStatus !== '') {
        query.set('chatStatus', String(params.chatStatus))
      }
      if (params.searchStr != null && params.searchStr !== '') {
        query.set('searchStr', String(params.searchStr))
      }
      if (params.isEnabled != null) query.set('isEnabled', String(params.isEnabled))
      if (params.limit != null) {
        const value = Number(params.limit)
        if (!Number.isInteger(value) || value < 0 || value > 200)
          throw new Error('limit is outside the documented range')
        query.set('limit', String(value))
      }
      if (params.from != null) {
        const value = Number(params.from)
        if (!Number.isInteger(value) || value < 0)
          throw new Error('from is outside the documented range')
        query.set('from', String(value))
      }
      return `${getZohoDeskApiBase(params)}/departments${query.size ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: buildZohoDeskHeaders,
  },
  transformResponse: async (response, params) => {
    const { items } = await readZohoDeskList(response)
    return {
      success: true,
      output: {
        departments: items.map((item) =>
          projectZohoDeskResource(item, ZOHO_DESK_DEPARTMENT_PROPERTIES)
        ),
        count: items.length,
        nextFrom: items.length ? Number(params?.from ?? 0) + items.length : null,
      },
    }
  },
  outputs: {
    departments: {
      type: 'array',
      description: 'List Departments results',
      items: { type: 'object', properties: ZOHO_DESK_DEPARTMENT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of results in this page' },
    nextFrom: {
      type: 'number',
      nullable: true,
      description:
        'Next index to request; null when this page is empty. The next request may return an empty page.',
    },
  },
}
