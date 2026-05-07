import type { DeleteExpectedExpenseParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteExpectedExpenseTool: ToolConfig<
  DeleteExpectedExpenseParams,
  SapConcurProxyResponse
> = {
  id: 'sap_concur_delete_expected_expense',
  name: 'SAP Concur Delete Expected Expense',
  description: 'Delete an expected expense (DELETE /travelrequest/v4/expenses/{expenseUuid}).',
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
    expenseUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expected expense UUID to delete',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'User UUID acting on the request (required when using a Company JWT, optional otherwise)',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const expenseUuid = trimRequired(params.expenseUuid, 'expenseUuid')
      const query: Record<string, string> = {}
      if (params.userId?.trim()) query.userId = params.userId.trim()
      return {
        ...baseProxyBody(params),
        path: `/travelrequest/v4/expenses/${encodeURIComponent(expenseUuid)}`,
        method: 'DELETE',
        ...(Object.keys(query).length > 0 ? { query } : {}),
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Returns boolean true on 200 OK when the expected expense is deleted.',
      properties: {},
    },
  },
}
