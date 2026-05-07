import type { GetItemizationsParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getItemizationsTool: ToolConfig<GetItemizationsParams, SapConcurProxyResponse> = {
  id: 'sap_concur_get_itemizations',
  name: 'SAP Concur Get Expense Itemizations',
  description:
    'Get expense itemizations (GET /expensereports/v4/users/{userId}/context/{contextType}/reports/{reportId}/expenses/{expenseId}/itemizations).',
  version: '1.0.0',
  params: {
    datacenter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Concur datacenter base URL (defaults to us.api.concursolutions.com)',
    },
    grantType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OAuth grant type: client_credentials (default) or password',
    },
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client secret',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Username (only for password grant)',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password (only for password grant)',
    },
    companyUuid: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Company UUID for multi-company access tokens',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Concur user UUID',
    },
    contextType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Access context: TRAVELER, MANAGER, or PROXY',
    },
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense report ID',
    },
    expenseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense ID',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const userId = trimRequired(params.userId, 'userId')
      const contextType = trimRequired(params.contextType, 'contextType')
      const reportId = trimRequired(params.reportId, 'reportId')
      const expenseId = trimRequired(params.expenseId, 'expenseId')
      return {
        ...baseProxyBody(params),
        path: `/expensereports/v4/users/${encodeURIComponent(userId)}/context/${encodeURIComponent(contextType)}/reports/${encodeURIComponent(reportId)}/expenses/${encodeURIComponent(expenseId)}/itemizations`,
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'array',
      description: 'Array of itemizations (ReportExpenseSummary[])',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Itemization identifier', optional: true },
          expenseId: { type: 'string', description: 'Itemization expense id', optional: true },
          allocations: {
            type: 'array',
            description: 'Allocations applied to the itemization',
            optional: true,
          },
          expenseType: {
            type: 'json',
            description: 'Expense type {id, name, code, isDeleted}',
            optional: true,
          },
          transactionDate: {
            type: 'string',
            description: 'Transaction date (YYYY-MM-DD)',
            optional: true,
          },
          transactionAmount: { type: 'json', description: 'Transaction amount', optional: true },
          postedAmount: { type: 'json', description: 'Posted amount', optional: true },
          approvedAmount: { type: 'json', description: 'Approved amount', optional: true },
          claimedAmount: { type: 'json', description: 'Claimed amount', optional: true },
          approverAdjustedAmount: {
            type: 'json',
            description: 'Approver-adjusted amount',
            optional: true,
          },
          paymentType: { type: 'json', description: 'Payment type', optional: true },
          vendor: { type: 'json', description: 'Vendor info', optional: true },
          location: { type: 'json', description: 'Location info', optional: true },
          allocationState: {
            type: 'string',
            description: 'Allocation state',
            optional: true,
          },
          allocationSetId: {
            type: 'string',
            description: 'Allocation set identifier',
            optional: true,
          },
          attendeeCount: { type: 'number', description: 'Attendee count', optional: true },
          businessPurpose: {
            type: 'string',
            description: 'Business purpose',
            optional: true,
          },
          hasBlockingExceptions: {
            type: 'boolean',
            description: 'Has blocking exceptions',
            optional: true,
          },
          hasExceptions: {
            type: 'boolean',
            description: 'Has exceptions',
            optional: true,
          },
          isPersonalExpense: {
            type: 'boolean',
            description: 'Personal expense',
            optional: true,
          },
          links: { type: 'array', description: 'HATEOAS links', optional: true },
        },
      },
    },
  },
}
