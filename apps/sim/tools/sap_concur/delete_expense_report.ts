import type { DeleteExpenseReportParams, SapConcurResponse } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  transformSapConcurResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const deleteExpenseReportTool: InternalToolConfig<
  DeleteExpenseReportParams,
  SapConcurResponse
> = {
  id: 'sap_concur_delete_expense_report',
  name: 'SAP Concur Delete Expense Report',
  description: 'Delete an expense report (DELETE /expensereports/v4/reports/{reportId}).',
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
      description: 'Expense report ID to delete',
    },
  },
  operation: {
    input: (params) => {
      const reportId = trimRequired(params.reportId, 'reportId')
      return {
        ...baseSapConcurInput(params),
        path: `/expensereports/v4/reports/${encodeURIComponent(reportId)}`,
        method: 'DELETE',
      }
    },
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: { type: 'json', description: 'Empty (204 No Content)' },
  },
}
