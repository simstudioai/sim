import type { ListReportCommentsParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  buildListQuery,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const listReportCommentsTool: ToolConfig<ListReportCommentsParams, SapConcurProxyResponse> =
  {
    id: 'sap_concur_list_report_comments',
    name: 'SAP Concur List Report Comments',
    description:
      'List comments on a report (GET /expensereports/v4/users/{userId}/context/{contextType}/reports/{reportId}/comments).',
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
      includeAllComments: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Include comments from all expenses in the report (default false)',
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
        return {
          ...baseProxyBody(params),
          path: `/expensereports/v4/users/${encodeURIComponent(userId)}/context/${encodeURIComponent(contextType)}/reports/${encodeURIComponent(reportId)}/comments`,
          method: 'GET',
          query: buildListQuery({ includeAllComments: params.includeAllComments }),
        }
      },
    },
    transformResponse: transformSapConcurProxyResponse,
    outputs: {
      status: { type: 'number', description: 'HTTP status code returned by Concur' },
      data: {
        type: 'array',
        description: 'Array of report comment entries',
        items: {
          type: 'json',
          properties: {
            comment: { type: 'string', description: 'Comment text' },
            creationDate: {
              type: 'string',
              description: 'Comment creation timestamp (ISO 8601)',
            },
            expenseId: { type: 'string', description: 'Related expense entry ID' },
            isAuditorComment: {
              type: 'boolean',
              description: 'Whether the comment was added by an auditor',
            },
            isLatest: {
              type: 'boolean',
              description: 'Whether this is the latest comment',
            },
            createdForEmployeeId: {
              type: 'string',
              description: 'Employee ID the comment was created for',
            },
            author: {
              type: 'json',
              description: 'Comment author',
              properties: {
                employeeId: { type: 'string', description: 'Employee identifier' },
                employeeUuid: { type: 'string', description: 'Employee UUID' },
              },
            },
            createdForEmployee: {
              type: 'json',
              description: 'Employee the comment was created for',
              properties: {
                employeeId: { type: 'string', description: 'Employee identifier' },
                employeeUuid: { type: 'string', description: 'Employee UUID' },
              },
            },
            stepInstanceId: {
              type: 'string',
              description: 'Workflow step instance identifier',
              optional: true,
            },
          },
        },
      },
    },
  }
