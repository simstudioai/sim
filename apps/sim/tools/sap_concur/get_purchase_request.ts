import type { GetPurchaseRequestParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getPurchaseRequestTool: ToolConfig<GetPurchaseRequestParams, SapConcurProxyResponse> =
  {
    id: 'sap_concur_get_purchase_request',
    name: 'SAP Concur Get Purchase Request',
    description: 'Get a purchase request by ID (GET /purchaserequest/v4/purchaserequests/{id}).',
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
      purchaseRequestId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Purchase request ID',
      },
    },
    request: {
      url: SAP_CONCUR_PROXY_URL,
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => {
        const purchaseRequestId = trimRequired(params.purchaseRequestId, 'purchaseRequestId')
        return {
          ...baseProxyBody(params),
          path: `/purchaserequest/v4/purchaserequests/${encodeURIComponent(purchaseRequestId)}?mode=COMPACT`,
          method: 'GET',
        }
      },
    },
    transformResponse: transformSapConcurProxyResponse,
    outputs: {
      status: { type: 'number', description: 'HTTP status code returned by Concur' },
      data: {
        type: 'json',
        description: 'Purchase request detail payload',
        properties: {
          purchaseRequestId: {
            type: 'string',
            description: 'Unique identifier of the purchase request',
            optional: true,
          },
          purchaseRequestNumber: {
            type: 'string',
            description: 'Human-readable purchase request number',
            optional: true,
          },
          purchaseRequestQueueStatus: {
            type: 'string',
            description: 'Queue status of the purchase request',
            optional: true,
          },
          purchaseRequestWorkflowStatus: {
            type: 'string',
            description: 'Workflow status of the purchase request',
            optional: true,
          },
          purchaseOrders: {
            type: 'array',
            description: 'Purchase orders generated from the request',
            optional: true,
            items: {
              type: 'json',
              properties: {
                purchaseOrderNumber: {
                  type: 'string',
                  description: 'Purchase order number',
                  optional: true,
                },
              },
            },
          },
          purchaseRequestExceptions: {
            type: 'array',
            description: 'Exceptions raised on the purchase request',
            optional: true,
            items: {
              type: 'json',
              properties: {
                eventCode: { type: 'string', description: 'Event code', optional: true },
                exceptionCode: {
                  type: 'string',
                  description: 'Exception code',
                  optional: true,
                },
                isCleared: {
                  type: 'boolean',
                  description: 'Whether the exception has been cleared',
                  optional: true,
                },
                prExceptionId: {
                  type: 'string',
                  description: 'Identifier of the exception record',
                  optional: true,
                },
                message: {
                  type: 'string',
                  description: 'Exception message',
                  optional: true,
                },
              },
            },
          },
        },
      },
    },
  }
