import type { SapConcurProxyResponse, UploadExchangeRatesParams } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const uploadExchangeRatesTool: ToolConfig<
  UploadExchangeRatesParams,
  SapConcurProxyResponse
> = {
  id: 'sap_concur_upload_exchange_rates',
  name: 'SAP Concur Upload Exchange Rates',
  description:
    'Bulk upload up to 100 custom exchange rates (POST /exchangerate/v4/rates). Body contains a currency_sets array, each with from_crn_code, to_crn_code, start_date (YYYY-MM-DD), and rate.',
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
        'Bulk upload body: { currency_sets: [{ from_crn_code, to_crn_code, start_date: "YYYY-MM-DD", rate }] } (max 100 entries)',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      path: `/exchangerate/v4/rates`,
      method: 'POST',
      body: params.body,
    }),
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Bulk-upload exchange rate response (Exchange Rate v4)',
      properties: {
        overallStatus: {
          type: 'string',
          description: 'Overall result status for the bulk upload (e.g. SUCCESS, FAILURE)',
          optional: true,
        },
        message: {
          type: 'string',
          description: 'Top-level result message',
          optional: true,
        },
        currencySets: {
          type: 'json',
          description:
            'Per-row results: array of { from_crn_code, to_crn_code, start_date, rate, statusCode, statusMessage }',
          optional: true,
        },
      },
    },
  },
}
