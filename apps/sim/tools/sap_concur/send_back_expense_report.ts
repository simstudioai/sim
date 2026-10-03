import type { SapConcurResponse, SendBackExpenseReportParams } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  transformSapConcurResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const sendBackExpenseReportTool: InternalToolConfig<
  SendBackExpenseReportParams,
  SapConcurResponse
> = {
  id: 'sap_concur_send_back_expense_report',
  name: 'SAP Concur Send Back Expense Report',
  description:
    'Send back an expense report to the employee (PATCH /expensereports/v4/reports/{reportId}/sendBack). Required body field: comment.',
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
      description: 'Expense report ID to send back',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Request body — `comment` is required by Concur (e.g., { "comment": "Missing receipt" }). Optional fields: `expectedStepCode`, `expectedStepSequence`.',
    },
  },
  operation: {
    input: (params) => {
      const reportId = trimRequired(params.reportId, 'reportId')
      return {
        ...baseSapConcurInput(params),
        path: `/expensereports/v4/reports/${encodeURIComponent(reportId)}/sendBack`,
        method: 'PATCH',
        body: params.body,
      }
    },
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: { type: 'json', description: 'Empty (204 No Content)' },
  },
}
