import type { CreatePurchaseRequestParams, SapConcurResponse } from '@/tools/sap_concur/types'
import { baseSapConcurInput, transformSapConcurResponse } from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const createPurchaseRequestTool: InternalToolConfig<
  CreatePurchaseRequestParams,
  SapConcurResponse
> = {
  id: 'sap_concur_create_purchase_request',
  name: 'SAP Concur Create Purchase Request',
  description: 'Create a purchase request (POST /purchaserequest/v4/purchaserequests).',
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
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Purchase request payload. Required: exactly one of userId, userEmail, or userLoginId; currencyCode (ISO 4217); and lineItems[]. Each line item requires purchaseType (GOODS or SERVICES), vendorCode, vendorAddressCode, description, quantity, and unitPrice.',
    },
  },
  operation: {
    input: (params) => ({
      ...baseSapConcurInput(params),
      path: `/purchaserequest/v4/purchaserequests`,
      method: 'POST',
      body: params.body,
    }),
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Created purchase request payload',
      properties: {
        id: {
          type: 'string',
          description: 'Identifier of the created purchase request',
          optional: true,
        },
        uri: {
          type: 'string',
          description: 'Resource URI for the created purchase request',
          optional: true,
        },
        errors: {
          type: 'array',
          description: 'Validation or processing errors returned by Concur',
          optional: true,
          items: {
            type: 'json',
            properties: {
              errorCode: { type: 'string', description: 'Error code', optional: true },
              errorMessage: { type: 'string', description: 'Error message', optional: true },
              dataPath: {
                type: 'string',
                description: 'Path to the request data which has the error',
                optional: true,
              },
            },
          },
        },
      },
    },
  },
}
