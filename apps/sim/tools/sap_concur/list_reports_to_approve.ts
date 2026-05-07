import type { ListReportsToApproveParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  buildListQuery,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const listReportsToApproveTool: ToolConfig<
  ListReportsToApproveParams,
  SapConcurProxyResponse
> = {
  id: 'sap_concur_list_reports_to_approve',
  name: 'SAP Concur List Reports To Approve',
  description:
    'List expense reports awaiting approval (GET /expensereports/v4/users/{userId}/context/MANAGER/reportsToApprove).',
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
      description: 'Manager user UUID',
    },
    contextType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Access context: must be MANAGER (default)',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Report field name to sort by (e.g., reportDate)',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: asc or desc',
    },
    includeDelegateApprovals: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include reports the caller can approve as a delegate',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const userId = trimRequired(params.userId, 'userId')
      const contextType = (params.contextType ?? 'MANAGER').trim() || 'MANAGER'
      return {
        ...baseProxyBody(params),
        path: `/expensereports/v4/users/${encodeURIComponent(userId)}/context/${encodeURIComponent(contextType)}/reportsToApprove`,
        method: 'GET',
        query: buildListQuery({
          sort: params.sort,
          order: params.order,
          includeDelegateApprovals: params.includeDelegateApprovals,
        }),
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'array',
      description: 'Array of reports awaiting approval (ReportToApprove[])',
      items: {
        type: 'json',
        properties: {
          reportId: { type: 'string', description: 'Unique report identifier' },
          name: { type: 'string', description: 'Report name' },
          reportDate: { type: 'string', description: 'Report date (YYYY-MM-DD)', optional: true },
          reportNumber: {
            type: 'string',
            description: 'User-friendly report number',
            optional: true,
          },
          submitDate: {
            type: 'string',
            description: 'Submission timestamp (ISO 8601 UTC)',
            optional: true,
          },
          approver: {
            type: 'json',
            description: 'Approver employee { employeeId, employeeUuid }',
            optional: true,
          },
          employee: {
            type: 'json',
            description: 'Report owner employee { employeeId, employeeUuid }',
            optional: true,
          },
          amountDueEmployee: {
            type: 'json',
            description: 'Amount due employee { value, currencyCode }',
            optional: true,
          },
          claimedAmount: {
            type: 'json',
            description: 'Total claimed amount { value, currencyCode }',
            optional: true,
          },
          totalApprovedAmount: {
            type: 'json',
            description: 'Total approved amount { value, currencyCode }',
            optional: true,
          },
          hasExceptions: {
            type: 'boolean',
            description: 'Whether the report has exceptions',
            optional: true,
          },
          reportType: {
            type: 'string',
            description: 'Report creation method identifier',
            optional: true,
          },
          links: { type: 'array', description: 'HATEOAS links', optional: true },
        },
      },
    },
  },
}
