import type { ToolConfig } from '@/tools/types'
import {
  projectZohoDeskResource,
  readZohoDeskList,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type {
  ZohoDeskSearchTicketsParams,
  ZohoDeskSearchTicketsResponse,
} from '@/tools/zoho_desk/types'
import { ZOHO_DESK_TICKET_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  normalizeZohoDeskCommaList,
} from '@/tools/zoho_desk/utils'

export const zohoDeskSearchTicketsTool: ToolConfig<
  ZohoDeskSearchTicketsParams,
  ZohoDeskSearchTicketsResponse
> = {
  id: 'zoho_desk_search_tickets',
  name: 'Zoho Desk Search Tickets',
  description: 'Search Tickets in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    searchEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `The corresponding email address associated with the ticket. example: 1. email=jack* 2.email=\${notempty} 3.email=\${empty}. Supports * wildcards. Supports empty/not-empty search operators. Comma-separated values.`,
    },
    searchPhone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The phone number provided in the ticket. Supports * wildcards. Supports empty/not-empty search operators. Comma-separated values.',
    },
    ticketNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The ticket's serial number. Exact match. Comma-separated values.",
    },
    searchAccountName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Name of the account associated with the ticket. Supports * wildcards. Supports empty/not-empty search operators.',
    },
    searchSubject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subject of the ticket. Supports * wildcards.',
    },
    searchDepartmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of the department from which the entity must be fetched. If the ID is not passed, then searches in all permitted departments. Exact match.',
    },
    productName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Name of the product associated with the ticket. Supports * wildcards. Supports empty/not-empty search operators.',
    },
    _all: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search text across all fields. Supports * wildcards; at least 3 characters.',
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
    dueDateRange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date range as two comma-separated ISO 8601 timestamps: start,end.',
    },
    ticketSearchIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the ticket. Exact match. Comma-separated values.',
    },
    searchProductId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of the product associated with the ticket. Exact match. Comma-separated values.',
    },
    searchContactId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the contact who raised the ticket. Exact match. Comma-separated values.',
    },
    createdTimeRange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Created time range as two comma-separated ISO 8601 timestamps: start,end.',
    },
    searchPriority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority of the ticket. Exact match. Comma-separated values.',
    },
    searchAssigneeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of the agent who is assigned to resolve the ticket. Exact match. Comma-separated values.',
    },
    searchAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of the account associated with the ticket. Exact match. Comma-separated values.',
    },
    modifiedTimeRange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Modified time range as two comma-separated ISO 8601 timestamps: start,end.',
    },
    searchStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Status of the ticket inclusive of custom status. example: 1. status=open,in progress 2. status=\${open}. Exact match. Comma-separated values.`,
    },
    ticketSearchCustomField1: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    ticketSearchCustomField2: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    ticketSearchCustomField3: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    ticketSearchCustomField4: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    ticketSearchCustomField5: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    ticketSearchCustomField6: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    ticketSearchCustomField7: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    ticketSearchCustomField8: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    ticketSearchCustomField9: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    ticketSearchCustomField10: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchChannel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The channel through which the ticket was received. Exact match. Supports empty/not-empty search operators.',
    },
    customerResponseTimeRange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Customer response time range as two comma-separated ISO 8601 timestamps: start,end.',
    },
    searchDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the ticket. Supports * wildcards.',
    },
    ticketSearchSortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort field: relevance, modifiedTime, createdTime, customerResponseTime. Prefix with - for descending.',
    },
    tag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The tag associated with the ticket. Supports * wildcards. Supports empty/not-empty search operators.',
    },
    contactName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The name of the contact who raised the ticket. Supports * wildcards.',
    },
    searchCategory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The category of the ticket. Supports * wildcards. Supports empty/not-empty search operators.',
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
      if (params.ticketNumber != null && params.ticketNumber !== '') {
        const value = normalizeZohoDeskCommaList(params.ticketNumber)
        if (value !== undefined) query.set('ticketNumber', String(value))
      }
      if (params.searchAccountName != null && params.searchAccountName !== '') {
        query.set('accountName', String(params.searchAccountName))
      }
      if (params.searchSubject != null && params.searchSubject !== '') {
        query.set('subject', String(params.searchSubject))
      }
      if (params.searchDepartmentId != null && params.searchDepartmentId !== '') {
        query.set('departmentId', String(params.searchDepartmentId))
      }
      if (params.productName != null && params.productName !== '') {
        query.set('productName', String(params.productName))
      }
      if (params._all != null && params._all !== '') {
        query.set('_all', String(params._all))
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
      if (params.dueDateRange != null && params.dueDateRange !== '') {
        query.set('dueDateRange', String(params.dueDateRange))
      }
      if (params.ticketSearchIds != null && params.ticketSearchIds !== '') {
        const value = normalizeZohoDeskCommaList(params.ticketSearchIds)
        if (value !== undefined) query.set('id', String(value))
      }
      if (params.searchProductId != null && params.searchProductId !== '') {
        const value = normalizeZohoDeskCommaList(params.searchProductId)
        if (value !== undefined) query.set('productId', String(value))
      }
      if (params.searchContactId != null && params.searchContactId !== '') {
        const value = normalizeZohoDeskCommaList(params.searchContactId)
        if (value !== undefined) query.set('contactId', String(value))
      }
      if (params.createdTimeRange != null && params.createdTimeRange !== '') {
        query.set('createdTimeRange', String(params.createdTimeRange))
      }
      if (params.searchPriority != null && params.searchPriority !== '') {
        const value = normalizeZohoDeskCommaList(params.searchPriority)
        if (value !== undefined) query.set('priority', String(value))
      }
      if (params.searchAssigneeId != null && params.searchAssigneeId !== '') {
        const value = normalizeZohoDeskCommaList(params.searchAssigneeId)
        if (value !== undefined) query.set('assigneeId', String(value))
      }
      if (params.searchAccountId != null && params.searchAccountId !== '') {
        const value = normalizeZohoDeskCommaList(params.searchAccountId)
        if (value !== undefined) query.set('accountId', String(value))
      }
      if (params.modifiedTimeRange != null && params.modifiedTimeRange !== '') {
        query.set('modifiedTimeRange', String(params.modifiedTimeRange))
      }
      if (params.searchStatus != null && params.searchStatus !== '') {
        const value = normalizeZohoDeskCommaList(params.searchStatus)
        if (value !== undefined) query.set('status', String(value))
      }
      if (params.ticketSearchCustomField1 != null && params.ticketSearchCustomField1 !== '') {
        query.set('customField1', String(params.ticketSearchCustomField1))
      }
      if (params.ticketSearchCustomField2 != null && params.ticketSearchCustomField2 !== '') {
        query.set('customField2', String(params.ticketSearchCustomField2))
      }
      if (params.ticketSearchCustomField3 != null && params.ticketSearchCustomField3 !== '') {
        query.set('customField3', String(params.ticketSearchCustomField3))
      }
      if (params.ticketSearchCustomField4 != null && params.ticketSearchCustomField4 !== '') {
        query.set('customField4', String(params.ticketSearchCustomField4))
      }
      if (params.ticketSearchCustomField5 != null && params.ticketSearchCustomField5 !== '') {
        query.set('customField5', String(params.ticketSearchCustomField5))
      }
      if (params.ticketSearchCustomField6 != null && params.ticketSearchCustomField6 !== '') {
        query.set('customField6', String(params.ticketSearchCustomField6))
      }
      if (params.ticketSearchCustomField7 != null && params.ticketSearchCustomField7 !== '') {
        query.set('customField7', String(params.ticketSearchCustomField7))
      }
      if (params.ticketSearchCustomField8 != null && params.ticketSearchCustomField8 !== '') {
        query.set('customField8', String(params.ticketSearchCustomField8))
      }
      if (params.ticketSearchCustomField9 != null && params.ticketSearchCustomField9 !== '') {
        query.set('customField9', String(params.ticketSearchCustomField9))
      }
      if (params.ticketSearchCustomField10 != null && params.ticketSearchCustomField10 !== '') {
        query.set('customField10', String(params.ticketSearchCustomField10))
      }
      if (params.searchChannel != null && params.searchChannel !== '') {
        query.set('channel', String(params.searchChannel))
      }
      if (params.customerResponseTimeRange != null && params.customerResponseTimeRange !== '') {
        query.set('customerResponseTimeRange', String(params.customerResponseTimeRange))
      }
      if (params.searchDescription != null && params.searchDescription !== '') {
        query.set('description', String(params.searchDescription))
      }
      if (params.ticketSearchSortBy != null && params.ticketSearchSortBy !== '') {
        query.set('sortBy', String(params.ticketSearchSortBy))
      }
      if (params.tag != null && params.tag !== '') {
        query.set('tag', String(params.tag))
      }
      if (params.contactName != null && params.contactName !== '') {
        query.set('contactName', String(params.contactName))
      }
      if (params.searchCategory != null && params.searchCategory !== '') {
        query.set('category', String(params.searchCategory))
      }
      return `${getZohoDeskApiBase(params)}/tickets/search${query.size ? `?${query}` : ''}`
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
        tickets: items.map((item) => projectZohoDeskResource(item, ZOHO_DESK_TICKET_PROPERTIES)),
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
    tickets: {
      type: 'array',
      description: 'Search Tickets results',
      items: { type: 'object', properties: ZOHO_DESK_TICKET_PROPERTIES },
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
