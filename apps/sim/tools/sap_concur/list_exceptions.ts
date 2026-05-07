import type { ListExceptionsParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const listExceptionsTool: ToolConfig<ListExceptionsParams, SapConcurProxyResponse> = {
  id: 'sap_concur_list_exceptions',
  name: 'SAP Concur List Report Exceptions',
  description:
    'List exceptions on a report (GET /expensereports/v4/users/{userId}/context/{contextType}/reports/{reportId}/exceptions).',
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
        path: `/expensereports/v4/users/${encodeURIComponent(userId)}/context/${encodeURIComponent(contextType)}/reports/${encodeURIComponent(reportId)}/exceptions`,
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'array',
      description: 'Array of report header exception entries',
      items: {
        type: 'json',
        properties: {
          exceptionCode: { type: 'string', description: 'Unique exception code' },
          exceptionVisibility: {
            type: 'string',
            description: 'Visibility scope: ALL, APPROVER_PROCESSOR, or PROCESSOR',
          },
          isBlocking: {
            type: 'boolean',
            description: 'Whether the exception prevents report submission',
          },
          message: { type: 'string', description: 'Human-readable description of the exception' },
          expenseId: {
            type: 'string',
            description: 'Related expense entry ID',
            optional: true,
          },
          allocationId: {
            type: 'string',
            description: 'Related allocation ID, if any',
            optional: true,
          },
          parentExpenseId: {
            type: 'string',
            description: 'Parent expense ID for itemized entries',
            optional: true,
          },
        },
      },
    },
  },
}
