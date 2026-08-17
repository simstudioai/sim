import type { ApproveExpenseReportParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const approveExpenseReportTool: ToolConfig<
  ApproveExpenseReportParams,
  SapConcurProxyResponse
> = {
  id: 'sap_concur_approve_expense_report',
  name: 'SAP Concur Approve Expense Report',
  description:
    'Approve an expense report as a manager (PATCH /expensereports/v4/reports/{reportId}/approve). Optional body fields: comment, expenseRejectedComment (required if the report has rejected expenses), expectedStepCode, expectedStepSequence, statusId (default A_APPR).',
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
      description: 'Expense report ID to approve',
    },
    body: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional request body. All fields are optional: `comment` (e.g., { "comment": "Approved" }), `expenseRejectedComment` (required only if the report contains rejected expenses), `expectedStepCode`, `expectedStepSequence`, `statusId` (defaults to "A_APPR").',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const reportId = trimRequired(params.reportId, 'reportId')
      return {
        ...baseProxyBody(params),
        path: `/expensereports/v4/reports/${encodeURIComponent(reportId)}/approve`,
        method: 'PATCH',
        body: params.body,
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: { type: 'json', description: 'Empty (204 No Content)' },
  },
}
