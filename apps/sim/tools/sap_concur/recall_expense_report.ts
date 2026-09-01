import type { RecallExpenseReportParams, SapConcurResponse } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  transformSapConcurResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const recallExpenseReportTool: InternalToolConfig<
  RecallExpenseReportParams,
  SapConcurResponse
> = {
  id: 'sap_concur_recall_expense_report',
  name: 'SAP Concur Recall Expense Report',
  description:
    'Recall a submitted expense report (PATCH /expensereports/v4/users/{userId}/context/{contextType}/reports/{reportId}/recall — supported contexts: TRAVELER, PROXY). Takes no request body. This operation supports user-level access tokens: set grantType to "password" with username and password, since the default client_credentials grant yields a company-level token.',
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
      description:
        'OAuth grant type: client_credentials (default) or password. Recall requires a user-level access token, so set this to "password" and supply username/password — client_credentials produces a company-level token that Concur rejects for this operation.',
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
      description: 'Concur user UUID who owns the report',
    },
    contextType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Access context: TRAVELER or PROXY',
    },
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense report ID to recall',
    },
  },
  operation: {
    input: (params) => {
      const userId = trimRequired(params.userId, 'userId')
      const contextType = trimRequired(params.contextType, 'contextType')
      const reportId = trimRequired(params.reportId, 'reportId')
      return {
        ...baseSapConcurInput(params),
        path: `/expensereports/v4/users/${encodeURIComponent(userId)}/context/${encodeURIComponent(contextType)}/reports/${encodeURIComponent(reportId)}/recall`,
        method: 'PATCH',
      }
    },
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: { type: 'json', description: 'Empty (204 No Content)' },
  },
}
