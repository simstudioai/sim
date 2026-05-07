import type { GetReceiptParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getReceiptTool: ToolConfig<GetReceiptParams, SapConcurProxyResponse> = {
  id: 'sap_concur_get_receipt',
  name: 'SAP Concur Get Receipt',
  description: 'Get a single receipt by ID (GET /receipts/v4/{receiptId}).',
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
        path: `/receipts/v4/${encodeURIComponent(receiptId)}`,
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Receipt detail payload',
      properties: {
        id: { type: 'string', description: 'Receipt identifier', optional: true },
        userId: { type: 'string', description: 'Owning user UUID', optional: true },
        dateTimeReceived: {
          type: 'string',
          description: 'Timestamp when the receipt was received (ISO 8601)',
          optional: true,
        },
        receipt: {
          type: 'json',
          description: 'Parsed receipt JSON object',
          optional: true,
        },
        image: {
          type: 'string',
          description: 'Receipt image URL or data reference',
          optional: true,
        },
        validationSchema: {
          type: 'string',
          description: 'Schema used to validate the receipt',
          optional: true,
        },
        self: {
          type: 'string',
          description: 'URL to this receipt resource',
          optional: true,
        },
        template: {
          type: 'string',
          description: 'URL template for receipts',
          optional: true,
        },
      },
    },
  },
}
