import type { ListExpenseReportsParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const listExpenseReportsTool: ToolConfig<ListExpenseReportsParams, SapConcurProxyResponse> =
  {
    id: 'sap_concur_list_expense_reports',
    name: 'SAP Concur List Expense Reports',
    description:
      'List expense reports (GET /api/v3.0/expense/reports). Returns a v3 envelope with Items and NextPage.',
    version: '1.0.0',
    params: {
      datacenter: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description:
          'Concur datacenter base URL (us, us2, eu, eu2, cn, emea — defaults to us.api.concursolutions.com)',
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
      user: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by a specific user (login id or user identifier).',
      },
      submitDateBefore: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter to reports submitted on or before this date (YYYY-MM-DD)',
      },
      submitDateAfter: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter to reports submitted on or after this date (YYYY-MM-DD)',
      },
      paidDateBefore: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter to reports paid on or before this date (YYYY-MM-DD)',
      },
      paidDateAfter: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter to reports paid on or after this date (YYYY-MM-DD)',
      },
      modifiedDateBefore: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter to reports last modified on or before this date (YYYY-MM-DD)',
      },
      modifiedDateAfter: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter to reports last modified on or after this date (YYYY-MM-DD)',
      },
      createDateBefore: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter to reports created on or before this date (YYYY-MM-DD)',
      },
      createDateAfter: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter to reports created on or after this date (YYYY-MM-DD)',
      },
      approvalStatusCode: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by approval status code (e.g. A_NOTF, A_PEND, A_APPR)',
      },
      paymentStatusCode: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by payment status code',
      },
      currencyCode: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by ISO currency code (e.g. USD, EUR)',
      },
      approverLoginID: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by approver login ID',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of records per page (default 25, max 100)',
      },
      offset: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Opaque cursor token returned by a prior call (NextPage).',
      },
    },
    request: {
      url: SAP_CONCUR_PROXY_URL,
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => {
        const query: Record<string, string | number> = {}
        if (params.user) query.user = params.user
        if (params.submitDateBefore) query.submitDateBefore = params.submitDateBefore
        if (params.submitDateAfter) query.submitDateAfter = params.submitDateAfter
        if (params.paidDateBefore) query.paidDateBefore = params.paidDateBefore
        if (params.paidDateAfter) query.paidDateAfter = params.paidDateAfter
        if (params.modifiedDateBefore) query.modifiedDateBefore = params.modifiedDateBefore
        if (params.modifiedDateAfter) query.modifiedDateAfter = params.modifiedDateAfter
        if (params.createDateBefore) query.createDateBefore = params.createDateBefore
        if (params.createDateAfter) query.createDateAfter = params.createDateAfter
        if (params.approvalStatusCode) query.approvalStatusCode = params.approvalStatusCode
        if (params.paymentStatusCode) query.paymentStatusCode = params.paymentStatusCode
        if (params.currencyCode) query.currencyCode = params.currencyCode
        if (params.approverLoginID) query.approverLoginID = params.approverLoginID
        if (params.limit !== undefined) query.limit = params.limit
        if (params.offset) query.offset = params.offset
        return {
          ...baseProxyBody(params),
          path: '/api/v3.0/expense/reports',
          method: 'GET',
          query,
        }
      },
    },
    transformResponse: transformSapConcurProxyResponse,
    outputs: {
      status: { type: 'number', description: 'HTTP status code returned by Concur' },
      data: {
        type: 'json',
        description: 'Concur v3 expense reports envelope',
        properties: {
          Items: {
            type: 'array',
            description: 'Array of report header objects',
            optional: true,
            items: {
              type: 'json',
              properties: {
                ID: { type: 'string', description: 'Report ID', optional: true },
                Name: { type: 'string', description: 'Report name', optional: true },
                OwnerLoginID: { type: 'string', description: 'Owner login ID', optional: true },
                OwnerName: { type: 'string', description: 'Owner display name', optional: true },
                Total: { type: 'number', description: 'Report total', optional: true },
                TotalApprovedAmount: {
                  type: 'number',
                  description: 'Total approved amount',
                  optional: true,
                },
                TotalClaimedAmount: {
                  type: 'number',
                  description: 'Total claimed amount',
                  optional: true,
                },
                AmountDueEmployee: {
                  type: 'number',
                  description: 'Amount due employee',
                  optional: true,
                },
                CurrencyCode: { type: 'string', description: 'ISO currency code', optional: true },
                ApprovalStatusName: {
                  type: 'string',
                  description: 'Approval status name',
                  optional: true,
                },
                ApprovalStatusCode: {
                  type: 'string',
                  description: 'Approval status code',
                  optional: true,
                },
                PaymentStatusName: {
                  type: 'string',
                  description: 'Payment status name',
                  optional: true,
                },
                PaymentStatusCode: {
                  type: 'string',
                  description: 'Payment status code',
                  optional: true,
                },
                ApproverLoginID: {
                  type: 'string',
                  description: 'Approver login ID',
                  optional: true,
                },
                ApproverName: {
                  type: 'string',
                  description: 'Approver display name',
                  optional: true,
                },
                HasException: {
                  type: 'boolean',
                  description: 'Whether the report has any exception',
                  optional: true,
                },
                ReceiptsReceived: {
                  type: 'boolean',
                  description: 'Whether paper receipts were received',
                  optional: true,
                },
                CreateDate: { type: 'string', description: 'Creation date', optional: true },
                SubmitDate: { type: 'string', description: 'Submit date', optional: true },
                LastModifiedDate: {
                  type: 'string',
                  description: 'Last modified date',
                  optional: true,
                },
                PaidDate: { type: 'string', description: 'Paid date', optional: true },
                URI: { type: 'string', description: 'Self URI', optional: true },
              },
            },
          },
          NextPage: {
            type: 'string',
            description: 'URI of the next page (use as offset cursor)',
            optional: true,
          },
        },
      },
    },
  }
