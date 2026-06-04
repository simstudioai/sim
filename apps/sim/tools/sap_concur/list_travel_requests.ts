import type { ListTravelRequestsParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  buildListQuery,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const listTravelRequestsTool: ToolConfig<ListTravelRequestsParams, SapConcurProxyResponse> =
  {
    id: 'sap_concur_list_travel_requests',
    name: 'SAP Concur List Travel Requests',
    description: 'List travel requests (GET /travelrequest/v4/requests).',
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
      view: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'View filter (e.g., ALL, ACTIVE, PENDING, TOAPPROVE)',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Max number of results per page',
      },
      start: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Page start cursor (offset)',
      },
      userId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by Concur user UUID',
      },
      approvedBefore: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'ISO 8601 date — return requests approved before this date',
      },
      approvedAfter: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'ISO 8601 date — return requests approved after this date',
      },
      modifiedBefore: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'ISO 8601 date — return requests modified before this date',
      },
      modifiedAfter: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'ISO 8601 date — return requests modified after this date',
      },
      sortField: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Field to sort by: startDate, approvalStatus, or requestId (default startDate)',
      },
      sortOrder: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Sort order: ASC or DESC (default DESC)',
      },
    },
    request: {
      url: SAP_CONCUR_PROXY_URL,
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        ...baseProxyBody(params),
        path: `/travelrequest/v4/requests`,
        method: 'GET',
        query: buildListQuery({
          view: params.view,
          limit: params.limit,
          start: params.start,
          userId: params.userId,
          approvedBefore: params.approvedBefore,
          approvedAfter: params.approvedAfter,
          modifiedBefore: params.modifiedBefore,
          modifiedAfter: params.modifiedAfter,
          sortField: params.sortField,
          sortOrder: params.sortOrder ? params.sortOrder.toUpperCase() : undefined,
        }),
      }),
    },
    transformResponse: transformSapConcurProxyResponse,
    outputs: {
      status: { type: 'number', description: 'HTTP status code returned by Concur' },
      data: {
        type: 'json',
        description: 'Travel requests list payload',
        properties: {
          data: {
            type: 'array',
            description: 'Array of travel request summaries',
            optional: true,
            items: {
              type: 'json',
              properties: {
                id: { type: 'string', description: 'Travel request UUID', optional: true },
                href: { type: 'string', description: 'Resource hyperlink', optional: true },
                requestId: {
                  type: 'string',
                  description: 'Public-facing request ID',
                  optional: true,
                },
                name: { type: 'string', description: 'Request name', optional: true },
                businessPurpose: {
                  type: 'string',
                  description: 'Business purpose',
                  optional: true,
                },
                comment: { type: 'string', description: 'Last attached comment', optional: true },
                creationDate: {
                  type: 'string',
                  description: 'Creation timestamp',
                  optional: true,
                },
                submitDate: {
                  type: 'string',
                  description: 'Last submission timestamp',
                  optional: true,
                },
                startDate: {
                  type: 'string',
                  description: 'Trip start date (ISO 8601)',
                  optional: true,
                },
                endDate: {
                  type: 'string',
                  description: 'Trip end date (ISO 8601)',
                  optional: true,
                },
                startTime: {
                  type: 'string',
                  description: 'Trip start time (HH:mm)',
                  optional: true,
                },
                approved: {
                  type: 'boolean',
                  description: 'Whether the request is approved',
                  optional: true,
                },
                pendingApproval: {
                  type: 'boolean',
                  description: 'Pending approval flag',
                  optional: true,
                },
                closed: { type: 'boolean', description: 'Closed flag', optional: true },
                everSentBack: {
                  type: 'boolean',
                  description: 'Ever-sent-back flag',
                  optional: true,
                },
                canceledPostApproval: {
                  type: 'boolean',
                  description: 'Canceled after approval flag',
                  optional: true,
                },
                approvalStatus: {
                  type: 'json',
                  description: 'Approval status',
                  optional: true,
                  properties: {
                    code: {
                      type: 'string',
                      description:
                        'Status code (NOT_SUBMITTED, SUBMITTED, APPROVED, CANCELED, SENTBACK)',
                      optional: true,
                    },
                    name: {
                      type: 'string',
                      description: 'Localized status name',
                      optional: true,
                    },
                  },
                },
                owner: {
                  type: 'json',
                  description: 'Travel request owner',
                  optional: true,
                  properties: {
                    id: { type: 'string', description: 'User UUID', optional: true },
                    firstName: {
                      type: 'string',
                      description: 'Owner first name',
                      optional: true,
                    },
                    lastName: {
                      type: 'string',
                      description: 'Owner last name',
                      optional: true,
                    },
                  },
                },
                approver: {
                  type: 'json',
                  description: 'Approver assigned to the request',
                  optional: true,
                  properties: {
                    id: { type: 'string', description: 'User UUID', optional: true },
                    firstName: {
                      type: 'string',
                      description: 'Approver first name',
                      optional: true,
                    },
                    lastName: {
                      type: 'string',
                      description: 'Approver last name',
                      optional: true,
                    },
                  },
                },
                type: {
                  type: 'json',
                  description: 'Request type',
                  optional: true,
                  properties: {
                    code: { type: 'string', description: 'Request type code', optional: true },
                    label: {
                      type: 'string',
                      description: 'Request type label',
                      optional: true,
                    },
                  },
                },
                totalApprovedAmount: {
                  type: 'json',
                  description: 'Total approved amount',
                  optional: true,
                  properties: {
                    value: { type: 'number', description: 'Amount value', optional: true },
                    currency: {
                      type: 'string',
                      description: 'Currency code',
                      optional: true,
                    },
                  },
                },
                totalPostedAmount: {
                  type: 'json',
                  description: 'Total posted amount',
                  optional: true,
                  properties: {
                    value: { type: 'number', description: 'Amount value', optional: true },
                    currency: {
                      type: 'string',
                      description: 'Currency code',
                      optional: true,
                    },
                  },
                },
                totalRemainingAmount: {
                  type: 'json',
                  description: 'Total remaining amount',
                  optional: true,
                  properties: {
                    value: { type: 'number', description: 'Amount value', optional: true },
                    currency: {
                      type: 'string',
                      description: 'Currency code',
                      optional: true,
                    },
                  },
                },
                expenses: {
                  type: 'array',
                  description: 'Resource links to expected expenses',
                  optional: true,
                  items: { type: 'json' },
                },
              },
            },
          },
          operations: {
            type: 'array',
            description: 'Pagination links (next, prev, first, last)',
            optional: true,
            items: {
              type: 'json',
              properties: {
                rel: { type: 'string', description: 'Link relation', optional: true },
                href: { type: 'string', description: 'Link target', optional: true },
                method: { type: 'string', description: 'HTTP method', optional: true },
                name: { type: 'string', description: 'Link name', optional: true },
              },
            },
          },
        },
      },
    },
  }
