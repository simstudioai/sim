import type {
  CreateQuickExpenseWithImageParams,
  SapConcurProxyResponse,
} from '@/tools/sap_concur/types'
import { SAP_CONCUR_UPLOAD_URL } from '@/tools/sap_concur/upload_receipt_image'
import {
  baseProxyBody,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const createQuickExpenseWithImageTool: ToolConfig<
  CreateQuickExpenseWithImageParams,
  SapConcurProxyResponse
> = {
  id: 'sap_concur_create_quick_expense_with_image',
  name: 'SAP Concur Create Quick Expense With Image',
  description:
    'Create a quick expense with an attached image (POST /quickexpense/v4/users/{userId}/context/{contextType}/quickexpenses/image).',
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
      description: 'Access context: must be TRAVELER',
    },
    receipt: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Receipt image (UserFile). Allowed: PDF, PNG, JPEG, TIFF (max 50MB)',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Quick expense payload (transactionAmount, transactionDate, expenseTypeId, vendor, ...)',
    },
  },
  request: {
    url: SAP_CONCUR_UPLOAD_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const userId = trimRequired(params.userId, 'userId')
      const contextType = trimRequired(params.contextType, 'contextType')
      return {
        ...baseProxyBody(params),
        operation: 'create_quick_expense_with_image',
        userId,
        contextType,
        receipt: params.receipt,
        body: params.body,
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Created quick expense response (HTTP 201 with attached receipt image)',
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
