import type { GetRequestCashAdvanceParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getRequestCashAdvanceTool: ToolConfig<
  GetRequestCashAdvanceParams,
  SapConcurProxyResponse
> = {
  id: 'sap_concur_get_request_cash_advance',
  name: 'SAP Concur Get Request Cash Advance',
  description:
    'Get a single cash advance assigned to a travel request (GET /travelrequest/v4/cashadvances/{cashAdvanceUuid}). This endpoint exists for feature parity only and will be deprecated in the future — SAP recommends relying on the list of cash advances link available in the Request payload response instead.',
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
    cashAdvanceUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Cash advance UUID (returned as part of a travel request)',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const cashAdvanceUuid = trimRequired(params.cashAdvanceUuid, 'cashAdvanceUuid')
      return {
        ...baseProxyBody(params),
        path: `/travelrequest/v4/cashadvances/${encodeURIComponent(cashAdvanceUuid)}`,
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Cash advance detail',
      properties: {
        cashAdvanceId: {
          type: 'string',
          description: 'Unique cash advance identifier',
          optional: true,
        },
        amountRequested: {
          type: 'json',
          description: 'Requested amount',
          optional: true,
          properties: {
            amount: {
              type: 'number',
              description: 'Preferred amount field — use this over value',
              optional: true,
            },
            value: {
              type: 'number',
              description: 'Legacy amount value — will soon be deprecated in favor of amount',
              optional: true,
            },
            currency: { type: 'string', description: 'Currency code', optional: true },
          },
        },
        approvalStatus: {
          type: 'json',
          description: 'Approval status',
          optional: true,
          properties: {
            code: { type: 'string', description: 'Status code', optional: true },
            name: { type: 'string', description: 'Status name', optional: true },
          },
        },
        requestDate: {
          type: 'string',
          description: 'Request datetime (ISO 8601)',
          optional: true,
        },
        issueDate: {
          type: 'string',
          description: 'Date the cash advance was issued (ISO 8601)',
          optional: true,
        },
        comment: {
          type: 'string',
          description: 'Comment attached to the cash advance',
          optional: true,
        },
        exchangeRate: {
          type: 'json',
          description: 'Exchange rate',
          optional: true,
          properties: {
            value: { type: 'number', description: 'Rate value', optional: true },
            operation: { type: 'string', description: 'Multiply or divide', optional: true },
          },
        },
      },
    },
  },
}
