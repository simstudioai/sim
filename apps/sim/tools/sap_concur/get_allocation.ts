import type { GetAllocationParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getAllocationTool: ToolConfig<GetAllocationParams, SapConcurProxyResponse> = {
  id: 'sap_concur_get_allocation',
  name: 'SAP Concur Get Allocation',
  description:
    'Get a single allocation (GET /expensereports/v4/users/{userId}/context/{contextType}/reports/{reportId}/allocations/{allocationId}).',
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
      description: 'Access context: TRAVELER or PROXY',
    },
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense report ID',
    },
    allocationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Allocation ID',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const userId = trimRequired(params.userId, 'userId')
      const contextType = trimRequired(params.contextType, 'contextType')
      const reportId = trimRequired(params.reportId, 'reportId')
      const allocationId = trimRequired(params.allocationId, 'allocationId')
      return {
        ...baseProxyBody(params),
        path: `/expensereports/v4/users/${encodeURIComponent(userId)}/context/${encodeURIComponent(contextType)}/reports/${encodeURIComponent(reportId)}/allocations/${encodeURIComponent(allocationId)}`,
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Allocation detail payload',
      properties: {
        allocationId: { type: 'string', description: 'Unique allocation identifier' },
        accountCode: { type: 'string', optional: true, description: 'Ledger account code' },
        overLimitAccountCode: {
          type: 'string',
          optional: true,
          description: 'Account code applied to amounts over the per-allocation limit',
        },
        percentage: { type: 'number', description: 'Allocation percentage' },
        allocationAmount: {
          type: 'json',
          description: 'Allocation amount (value, currencyCode)',
          properties: {
            value: { type: 'number', description: 'Amount value' },
            currencyCode: { type: 'string', description: 'ISO 4217 currency code' },
          },
        },
        approvedAmount: {
          type: 'json',
          description: 'Pro-rated approved amount (value, currencyCode)',
          properties: {
            value: { type: 'number', description: 'Amount value' },
            currencyCode: { type: 'string', description: 'ISO 4217 currency code' },
          },
        },
        claimedAmount: {
          type: 'json',
          description: 'Requested reimbursement amount (value, currencyCode)',
          properties: {
            value: { type: 'number', description: 'Amount value' },
            currencyCode: { type: 'string', description: 'ISO 4217 currency code' },
          },
        },
        customData: {
          type: 'array',
          optional: true,
          description: 'Custom field values (id, value, isValid)',
        },
        expenseId: { type: 'string', description: 'Associated expense identifier' },
        isSystemAllocation: {
          type: 'boolean',
          description: 'True when system-managed',
        },
        isPercentEdited: {
          type: 'boolean',
          description: 'True when the percentage was manually edited',
        },
      },
    },
  },
}
