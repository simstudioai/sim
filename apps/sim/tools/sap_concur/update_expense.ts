import type { SapConcurProxyResponse, UpdateExpenseParams } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const updateExpenseTool: ToolConfig<UpdateExpenseParams, SapConcurProxyResponse> = {
  id: 'sap_concur_update_expense',
  name: 'SAP Concur Update Expense',
  description:
    'Update an expense (PATCH /expensereports/v4/reports/{reportId}/expenses/{expenseId}).',
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
      description: 'Expense ID to update',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'PATCH body. Allowed fields: businessPurpose (string, max 64), customData (CustomData[]), expenseSource (required: EA|MOB|OTHER|SE|TA|TR|UI), isExpenseRejected (boolean), isPaperReceiptReceived (boolean).',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const reportId = trimRequired(params.reportId, 'reportId')
      const expenseId = trimRequired(params.expenseId, 'expenseId')
      return {
        ...baseProxyBody(params),
        path: `/expensereports/v4/reports/${encodeURIComponent(reportId)}/expenses/${encodeURIComponent(expenseId)}`,
        method: 'PATCH',
        body: params.body,
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description:
        'Empty body on success (HTTP 204 No Content). Error details when status is non-2xx',
      properties: {},
    },
  },
}
