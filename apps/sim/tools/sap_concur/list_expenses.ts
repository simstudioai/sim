import type { ListExpensesParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const listExpensesTool: ToolConfig<ListExpensesParams, SapConcurProxyResponse> = {
  id: 'sap_concur_list_expenses',
  name: 'SAP Concur List Expenses',
  description:
    'List expenses on a report (GET /expensereports/v4/users/{userId}/context/{contextType}/reports/{reportId}/expenses).',
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
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const userId = trimRequired(params.userId, 'userId')
      const contextType = trimRequired(params.contextType, 'contextType')
      const reportId = trimRequired(params.reportId, 'reportId')
      return {
        ...baseProxyBody(params),
        path: `/expensereports/v4/users/${encodeURIComponent(userId)}/context/${encodeURIComponent(contextType)}/reports/${encodeURIComponent(reportId)}/expenses`,
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'array',
      description: 'Array of expense summary entries (ReportExpenseSummary[])',
      items: {
        type: 'json',
        properties: {
          expenseId: { type: 'string', description: 'Expense identifier', optional: true },
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
          transactionAmount: {
            type: 'json',
            description: 'Transaction amount {currencyCode, value}',
            optional: true,
          },
          postedAmount: { type: 'json', description: 'Posted amount', optional: true },
          approvedAmount: { type: 'json', description: 'Approved amount', optional: true },
          claimedAmount: { type: 'json', description: 'Claimed amount', optional: true },
          approverAdjustedAmount: {
            type: 'json',
            description: 'Approver-adjusted amount',
            optional: true,
          },
          paymentType: {
            type: 'json',
            description: 'Payment type {id, name, code}',
            optional: true,
          },
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
            description: 'Has submission-blocking exceptions',
            optional: true,
          },
          hasExceptions: {
            type: 'boolean',
            description: 'Has exceptions',
            optional: true,
          },
          hasMissingReceiptDeclaration: {
            type: 'boolean',
            description: 'Has missing-receipt declaration',
            optional: true,
          },
          isAutoCreated: { type: 'boolean', description: 'Auto-created', optional: true },
          isPersonalExpense: {
            type: 'boolean',
            description: 'Personal-expense flag',
            optional: true,
          },
          isImageRequired: {
            type: 'boolean',
            description: 'Receipt image required',
            optional: true,
          },
          isPaperReceiptRequired: {
            type: 'boolean',
            description: 'Paper receipt required',
            optional: true,
          },
          imageCertificationStatus: {
            type: 'string',
            description: 'Receipt image certification status',
            optional: true,
          },
          receiptImageId: {
            type: 'string',
            description: 'Receipt image identifier',
            optional: true,
          },
          ereceiptImageId: {
            type: 'string',
            description: 'eReceipt image identifier',
            optional: true,
          },
          ticketNumber: {
            type: 'string',
            description: 'Ticket number',
            optional: true,
          },
          exchangeRate: { type: 'json', description: 'Exchange rate', optional: true },
          travelAllowance: {
            type: 'json',
            description: 'Travel allowance',
            optional: true,
          },
          expenseSourceIdentifiers: {
            type: 'json',
            description: 'Expense source identifiers',
            optional: true,
          },
          links: { type: 'array', description: 'HATEOAS links', optional: true },
        },
      },
    },
  },
}
