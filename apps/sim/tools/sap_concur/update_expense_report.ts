import type { SapConcurProxyResponse, UpdateExpenseReportParams } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const updateExpenseReportTool: ToolConfig<
  UpdateExpenseReportParams,
  SapConcurProxyResponse
> = {
  id: 'sap_concur_update_expense_report',
  name: 'SAP Concur Update Expense Report',
  description:
    'Update an unsubmitted expense report (PATCH /expensereports/v4/users/{userId}/context/{contextType}/reports/{reportId} — supported contexts: TRAVELER, PROXY). Body fields: businessPurpose, comment, customData, name, etc.',
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
      description: 'Concur user UUID who owns the report',
    },
    contextType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Access context: TRAVELER (own report) or PROXY (editing on behalf of another user)',
    },
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense report ID to update',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Fields to update on the report',
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
        path: `/expensereports/v4/users/${encodeURIComponent(userId)}/context/${encodeURIComponent(contextType)}/reports/${encodeURIComponent(reportId)}`,
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
