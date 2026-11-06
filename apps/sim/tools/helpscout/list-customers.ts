import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutListCustomersParams,
  HelpScoutListCustomersResponse,
} from '@/tools/helpscout/types'
import { HELPSCOUT_CUSTOMER_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  buildHelpScoutUrl,
  embeddedList,
  LIST_PAGE_OUTPUTS,
  PAGE_PARAM,
  parseOptionalHelpScoutId,
  projectCustomer,
  projectPage,
  validatePage,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutListCustomersTool: ToolConfig<
  HelpScoutListCustomersParams,
  HelpScoutListCustomersResponse
> = {
  id: 'helpscout_list_customers',
  name: 'Help Scout List Customers',
  description:
    'List and search Help Scout customers by inbox, name, modification date, or search query (for example by email). Returns 50 customers per page.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    mailboxId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inbox ID to filter by',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name to filter by',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name to filter by',
    },
    modifiedSince: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only customers modified after this time (e.g. 2024-05-04T12:00:03Z)',
    },
    sortField: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'createdAt, firstName, lastName, or modifiedAt (defaults to createdAt)',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'asc or desc (defaults to desc)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Advanced search query, e.g. (email:"jane@example.com")',
    },
    page: PAGE_PARAM,
  },
  request: {
    url: (params) =>
      buildHelpScoutUrl('/customers', {
        mailbox: parseOptionalHelpScoutId(params.mailboxId, 'mailboxId'),
        firstName: params.firstName?.trim(),
        lastName: params.lastName?.trim(),
        modifiedSince: params.modifiedSince?.trim(),
        sortField: params.sortField?.trim(),
        sortOrder: params.sortOrder?.trim(),
        query: params.query?.trim(),
        page: validatePage(params.page),
      }),
    method: 'GET',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        customers: embeddedList(data, 'customers').map(projectCustomer),
        ...projectPage(data),
      },
    }
  },
  outputs: {
    customers: {
      type: 'array',
      description: 'Customers on this page',
      items: { type: 'object', properties: HELPSCOUT_CUSTOMER_PROPERTIES },
    },
    ...LIST_PAGE_OUTPUTS,
  },
}
