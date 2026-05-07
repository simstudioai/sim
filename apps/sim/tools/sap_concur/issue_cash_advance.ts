import type { IssueCashAdvanceParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const issueCashAdvanceTool: ToolConfig<IssueCashAdvanceParams, SapConcurProxyResponse> = {
  id: 'sap_concur_issue_cash_advance',
  name: 'SAP Concur Issue Cash Advance',
  description: 'Issue a cash advance (POST /cashadvance/v4.1/cashadvances/{cashAdvanceId}/issue).',
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
      description: 'Cash advance ID to issue',
    },
    body: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional request body',
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
        path: `/cashadvance/v4.1/cashadvances/${encodeURIComponent(cashAdvanceId)}/issue`,
        method: 'POST',
        body: params.body ?? {},
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Issue cash advance result payload',
      properties: {
        issuedDate: {
          type: 'string',
          description: 'Date the cash advance was issued (YYYY-MM-DD)',
          optional: true,
        },
        status: {
          type: 'json',
          description: 'Cash advance status after the issue action',
          optional: true,
          properties: {
            code: { type: 'string', description: 'Status code', optional: true },
            name: { type: 'string', description: 'Status display name', optional: true },
          },
        },
      },
    },
  },
}
