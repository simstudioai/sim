import type { CreateQuickExpenseParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const createQuickExpenseTool: ToolConfig<CreateQuickExpenseParams, SapConcurProxyResponse> =
  {
    id: 'sap_concur_create_quick_expense',
    name: 'SAP Concur Create Quick Expense',
    description:
      'Create a quick expense (POST /quickexpense/v4/users/{userId}/context/TRAVELER/quickexpenses).',
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
        description: 'Concur user UUID who owns the quick expense',
      },
      contextType: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Access context: must be TRAVELER',
      },
      body: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Quick expense payload (expenseTypeId, transactionAmount, transactionDate, etc.)',
      },
    },
    request: {
      url: SAP_CONCUR_PROXY_URL,
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => {
        const userId = trimRequired(params.userId, 'userId')
        const contextType = trimRequired(params.contextType, 'contextType')
        return {
          ...baseProxyBody(params),
          path: `/quickexpense/v4/users/${encodeURIComponent(userId)}/context/${encodeURIComponent(contextType)}/quickexpenses`,
          method: 'POST',
          body: params.body,
        }
      },
    },
    transformResponse: transformSapConcurProxyResponse,
    outputs: {
      status: { type: 'number', description: 'HTTP status code returned by Concur' },
      data: {
        type: 'json',
        description: 'Created quick expense response (HTTP 201 Created)',
        properties: {
          quickExpenseIdUri: {
            type: 'string',
            description: 'URI of the created quick expense resource',
            optional: true,
          },
        },
      },
    },
  }
