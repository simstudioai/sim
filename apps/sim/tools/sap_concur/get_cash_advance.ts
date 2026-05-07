import type { GetCashAdvanceParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getCashAdvanceTool: ToolConfig<GetCashAdvanceParams, SapConcurProxyResponse> = {
  id: 'sap_concur_get_cash_advance',
  name: 'SAP Concur Get Cash Advance',
  description: 'Get a cash advance (GET /cashadvance/v4.1/cashadvances/{cashAdvanceId}).',
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
    cashAdvanceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Cash advance ID',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const cashAdvanceId = trimRequired(params.cashAdvanceId, 'cashAdvanceId')
      return {
        ...baseProxyBody(params),
        path: `/cashadvance/v4.1/cashadvances/${encodeURIComponent(cashAdvanceId)}`,
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Cash advance detail payload',
      properties: {
        cashAdvanceId: { type: 'string', description: 'Unique identifier of the cash advance' },
        name: { type: 'string', description: 'Cash advance name', optional: true },
        purpose: {
          type: 'string',
          description: 'Purpose for the cash advance',
          optional: true,
        },
        comment: {
          type: 'string',
          description: 'Comment recorded on the cash advance',
          optional: true,
        },
        accountCode: {
          type: 'string',
          description: 'Account code linked to the employee',
          optional: true,
        },
        requestDate: {
          type: 'string',
          description: 'Datetime the cash advance was requested (UTC, YYYY-MM-DD hh:mm:ss)',
          optional: true,
        },
        issuedDate: {
          type: 'string',
          description: 'Datetime the cash advance was issued (UTC, YYYY-MM-DD hh:mm:ss)',
          optional: true,
        },
        lastModifiedDate: {
          type: 'string',
          description: 'Datetime the cash advance was last modified (UTC, YYYY-MM-DD hh:mm:ss)',
          optional: true,
        },
        hasReceipts: {
          type: 'boolean',
          description: 'Whether the cash advance has receipts',
          optional: true,
        },
        reimbursementCurrency: {
          type: 'string',
          description: 'Reimbursement currency (3-letter ISO 4217 currency code)',
          optional: true,
        },
        amountRequested: {
          type: 'json',
          description: 'Amount requested for the cash advance',
          optional: true,
          properties: {
            amount: { type: 'string', description: 'Requested amount value', optional: true },
            currency: {
              type: 'string',
              description: '3-letter ISO 4217 currency code',
              optional: true,
            },
          },
        },
        availableBalance: {
          type: 'json',
          description: 'Unsubmitted balance for the cash advance',
          optional: true,
          properties: {
            amount: { type: 'string', description: 'Balance amount', optional: true },
            currency: {
              type: 'string',
              description: '3-letter ISO 4217 currency code',
              optional: true,
            },
          },
        },
        exchangeRate: {
          type: 'json',
          description: 'Exchange rate that applies to the cash advance',
          optional: true,
          properties: {
            value: { type: 'string', description: 'Exchange rate value', optional: true },
            operation: {
              type: 'string',
              description: 'Exchange rate operation (MULTIPLY)',
              optional: true,
            },
          },
        },
        approvalStatus: {
          type: 'json',
          description: 'Approval status of the cash advance',
          optional: true,
          properties: {
            code: { type: 'string', description: 'Status code', optional: true },
            name: { type: 'string', description: 'Status display name', optional: true },
          },
        },
        paymentType: {
          type: 'json',
          description: 'Payment type for the cash advance',
          optional: true,
          properties: {
            paymentCode: { type: 'string', description: 'Payment type code', optional: true },
            description: {
              type: 'string',
              description: 'Payment method description',
              optional: true,
            },
          },
        },
      },
    },
  },
}
