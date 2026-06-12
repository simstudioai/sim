import type { ListReceiptsParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const listReceiptsTool: ToolConfig<ListReceiptsParams, SapConcurProxyResponse> = {
  id: 'sap_concur_list_receipts',
  name: 'SAP Concur List Receipts',
  description: 'List receipts for a user (GET /receipts/v4/users/{userId}).',
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
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const userId = trimRequired(params.userId, 'userId')
      return {
        ...baseProxyBody(params),
        path: `/receipts/v4/users/${encodeURIComponent(userId)}`,
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'array',
      description: 'Array of e-receipt objects',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Receipt id', optional: true },
          userId: { type: 'string', description: 'Owner user UUID', optional: true },
          dateTimeReceived: {
            type: 'string',
            description: 'Timestamp the receipt was received',
            optional: true,
          },
          receipt: { type: 'json', description: 'Structured receipt data', optional: true },
          image: { type: 'string', description: 'Receipt image URL or reference', optional: true },
          validationSchema: {
            type: 'string',
            description: 'Validation schema URI',
            optional: true,
          },
          self: { type: 'string', description: 'Self URL', optional: true },
          template: { type: 'string', description: 'Template URL', optional: true },
        },
      },
    },
  },
}
