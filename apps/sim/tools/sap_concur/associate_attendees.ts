import type { AssociateAttendeesParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const associateAttendeesTool: ToolConfig<AssociateAttendeesParams, SapConcurProxyResponse> =
  {
    id: 'sap_concur_associate_attendees',
    name: 'SAP Concur Associate Attendees',
    description:
      'Associate attendees with an expense (POST /expensereports/v4/users/{userId}/context/{contextType}/reports/{reportId}/expenses/{expenseId}/attendees).',
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
      expenseId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Expense ID',
      },
      body: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description: 'Attendee associations payload (e.g., { "attendeeAssociations": [...] })',
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
        const expenseId = trimRequired(params.expenseId, 'expenseId')
        return {
          ...baseProxyBody(params),
          path: `/expensereports/v4/users/${encodeURIComponent(userId)}/context/${encodeURIComponent(contextType)}/reports/${encodeURIComponent(reportId)}/expenses/${encodeURIComponent(expenseId)}/attendees`,
          method: 'POST',
          body: params.body,
        }
      },
    },
    transformResponse: transformSapConcurProxyResponse,
    outputs: {
      status: { type: 'number', description: 'HTTP status code returned by Concur' },
      data: {
        type: 'json',
        description: 'Concur association response (201 Created with URI)',
        properties: {
          uri: {
            type: 'string',
            description: 'Resource URI of the attendee associations collection',
            optional: true,
          },
        },
      },
    },
  }
