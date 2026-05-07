import type { GetReceiptStatusParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getReceiptStatusTool: ToolConfig<GetReceiptStatusParams, SapConcurProxyResponse> = {
  id: 'sap_concur_get_receipt_status',
  name: 'SAP Concur Get Receipt Status',
  description: 'Get receipt processing status (GET /receipts/v4/status/{receiptId}).',
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
    receiptId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Receipt ID',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const receiptId = trimRequired(params.receiptId, 'receiptId')
      return {
        ...baseProxyBody(params),
        path: `/receipts/v4/status/${encodeURIComponent(receiptId)}`,
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Receipt status payload',
      properties: {
        status: {
          type: 'string',
          description: 'Processing status: ACCEPTED, PROCESSING, PROCESSED, or FAILED',
          optional: true,
        },
        logs: {
          type: 'array',
          description: 'Array of log entries',
          optional: true,
          items: {
            type: 'json',
            properties: {
              logLevel: { type: 'string', description: 'Log level', optional: true },
              message: { type: 'string', description: 'Log message', optional: true },
              timestamp: { type: 'string', description: 'Log timestamp', optional: true },
            },
          },
        },
      },
    },
  },
}
