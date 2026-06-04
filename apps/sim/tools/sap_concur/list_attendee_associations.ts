import type {
  ListAttendeeAssociationsParams,
  SapConcurProxyResponse,
} from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const listAttendeeAssociationsTool: ToolConfig<
  ListAttendeeAssociationsParams,
  SapConcurProxyResponse
> = {
  id: 'sap_concur_list_attendee_associations',
  name: 'SAP Concur List Attendee Associations',
  description:
    'List attendees associated with an expense (GET /expensereports/v4/users/{userId}/context/{contextType}/reports/{reportId}/expenses/{expenseId}/attendees).',
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
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Attendees list payload',
      properties: {
        noShowAttendeeCount: {
          type: 'number',
          description: 'Number of unnamed/no-show attendees',
          optional: true,
        },
        expenseAttendeeList: {
          type: 'array',
          description: 'Attendees associated with the expense, including amounts',
          items: {
            type: 'json',
            properties: {
              attendeeId: { type: 'string', description: 'Unique identifier of the attendee' },
              transactionAmount: {
                type: 'json',
                description: 'Expense portion assigned to this attendee',
                properties: {
                  value: { type: 'number', description: 'Numeric amount' },
                  currencyCode: { type: 'string', description: 'ISO 4217 currency code' },
                },
              },
              approvedAmount: {
                type: 'json',
                description: 'Approved amount in report currency',
                properties: {
                  value: { type: 'number', description: 'Numeric amount' },
                  currencyCode: { type: 'string', description: 'ISO 4217 currency code' },
                },
              },
              isAmountUserEdited: {
                type: 'boolean',
                description: 'Whether the amount was manually edited',
                optional: true,
              },
              isTraveling: {
                type: 'boolean',
                description: 'Whether the attendee is traveling (affects tax calculations)',
                optional: true,
              },
              associatedAttendeeCount: {
                type: 'number',
                description: 'Total attendee count; greater than 1 indicates unnamed attendees',
                optional: true,
              },
              versionNumber: {
                type: 'number',
                description: 'Version number preserving previous attendee state',
                optional: true,
              },
              customData: {
                type: 'array',
                description: 'Custom field values for the association',
                optional: true,
                items: {
                  type: 'json',
                  properties: {
                    id: { type: 'string', description: 'Custom field identifier' },
                    value: {
                      type: 'string',
                      description: 'Custom field value (max 48 characters)',
                      optional: true,
                    },
                    isValid: {
                      type: 'boolean',
                      description: 'Whether the value passes validation',
                      optional: true,
                    },
                    listItemUrl: {
                      type: 'string',
                      description: 'HATEOAS link for list items',
                      optional: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}
