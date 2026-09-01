import type { MoveTravelRequestParams, SapConcurResponse } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  transformSapConcurResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const moveTravelRequestTool: InternalToolConfig<MoveTravelRequestParams, SapConcurResponse> =
  {
    id: 'sap_concur_move_travel_request',
    name: 'SAP Concur Move Travel Request',
    description:
      'Move a travel request through workflow (POST /travelrequest/v4/requests/{requestUuid}/{action}). Valid actions: submit, recall, cancel, approve, sendback, close, reopen.',
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
      requestUuid: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Travel request UUID',
      },
      action: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Workflow action: submit, recall, cancel, approve, sendback, close, reopen',
      },
      userId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'The unique identifier of the user performing the status transition. Required when connecting with a Company token for traveler and Non traveler actions only; not required for External system validation actions. If empty, a 400 `missingRequiredParam` error code is returned. For non-traveler actions, if not provided, "System, Concur" is displayed in the Audit Trail of the Request.',
      },
      companyID: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Optional company identifier for the workflow action (documented as `companyID`, distinct from the companyUuid auth field)',
      },
      comment: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comment sent as a query parameter. Only works when the workflow action is `sendback`. This comment is visible wherever Request comments are available.',
      },
      body: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Optional payload — only the `sendback` action accepts one (e.g., { "comment": "..." }). Every other action takes no payload.',
      },
    },
    operation: {
      input: (params) => {
        const requestUuid = trimRequired(params.requestUuid, 'requestUuid')
        const action = trimRequired(params.action, 'action')
        const query: Record<string, string> = {}
        const userId = params.userId?.trim()
        if (userId) query.userId = userId
        if (params.companyID) query.companyID = params.companyID.trim()
        if (params.comment) query.comment = params.comment.trim()
        const body = typeof params.body === 'string' ? params.body.trim() || undefined : params.body
        return {
          ...baseSapConcurInput(params),
          path: `/travelrequest/v4/requests/${encodeURIComponent(requestUuid)}/${encodeURIComponent(action)}`,
          method: 'POST',
          ...(body === undefined ? {} : { body }),
          query: Object.keys(query).length > 0 ? query : undefined,
        }
      },
    },
    transformResponse: transformSapConcurResponse,
    outputs: {
      status: { type: 'number', description: 'HTTP status code returned by Concur' },
      data: {
        type: 'json',
        description:
          'The full travel request having that requestUuid, after the workflow transition',
        properties: {
          id: { type: 'string', description: 'Travel request UUID', optional: true },
          href: { type: 'string', description: 'Resource hyperlink', optional: true },
          requestId: {
            type: 'string',
            description: 'Public-facing request ID (4-6 alphanumeric characters)',
            optional: true,
          },
          name: { type: 'string', description: 'Request name', optional: true },
          businessPurpose: { type: 'string', description: 'Business purpose', optional: true },
          comment: { type: 'string', description: 'Last attached comment', optional: true },
          creationDate: { type: 'string', description: 'Creation timestamp', optional: true },
          lastModified: {
            type: 'string',
            description: 'Last modification timestamp',
            optional: true,
          },
          submitDate: { type: 'string', description: 'Last submission timestamp', optional: true },
          authorizedDate: {
            type: 'string',
            description: 'Date when approval was completed',
            optional: true,
          },
          approvalLimitDate: {
            type: 'string',
            description: 'Required approval deadline',
            optional: true,
          },
          startDate: { type: 'string', description: 'Trip start date (ISO 8601)', optional: true },
          endDate: { type: 'string', description: 'Trip end date (ISO 8601)', optional: true },
          startTime: { type: 'string', description: 'Trip start time (HH:mm)', optional: true },
          endTime: { type: 'string', description: 'Trip end time (HH:mm)', optional: true },
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
          everSentBack: { type: 'boolean', description: 'Ever-sent-back flag', optional: true },
          canceledPostApproval: {
            type: 'boolean',
            description: 'Canceled after approval flag',
            optional: true,
          },
          highestExceptionLevel: {
            type: 'string',
            description: 'Highest exception level (WARNING, ERROR, NONE)',
            optional: true,
          },
          approvalStatus: {
            type: 'json',
            description: 'Approval status after the workflow transition',
            optional: true,
            properties: {
              code: {
                type: 'string',
                description: 'Status code (NOT_SUBMITTED, SUBMITTED, APPROVED, CANCELED, SENTBACK)',
                optional: true,
              },
              name: { type: 'string', description: 'Localized status name', optional: true },
            },
          },
          owner: {
            type: 'json',
            description: 'Travel request owner',
            optional: true,
            properties: {
              id: { type: 'string', description: 'User UUID', optional: true },
              firstName: { type: 'string', description: 'Owner first name', optional: true },
              lastName: { type: 'string', description: 'Owner last name', optional: true },
            },
          },
          approver: {
            type: 'json',
            description: 'Approver assigned after the transition',
            optional: true,
            properties: {
              id: { type: 'string', description: 'User UUID', optional: true },
              firstName: { type: 'string', description: 'Approver first name', optional: true },
              lastName: { type: 'string', description: 'Approver last name', optional: true },
            },
          },
          policy: {
            type: 'json',
            description: 'Resource link to the applicable policy',
            optional: true,
            properties: {
              id: { type: 'string', description: 'Policy ID', optional: true },
              href: { type: 'string', description: 'Policy hyperlink', optional: true },
            },
          },
          type: {
            type: 'json',
            description: 'Request type',
            optional: true,
            properties: {
              code: { type: 'string', description: 'Request type code', optional: true },
              label: { type: 'string', description: 'Request type label', optional: true },
            },
          },
          mainDestination: {
            type: 'json',
            description: 'Main destination of the trip',
            optional: true,
            properties: {
              city: { type: 'string', description: 'City', optional: true },
              countryCode: { type: 'string', description: 'ISO country code', optional: true },
              countrySubDivisionCode: {
                type: 'string',
                description: 'ISO country sub-division code',
                optional: true,
              },
              name: { type: 'string', description: 'Destination name', optional: true },
            },
          },
          totalApprovedAmount: {
            type: 'json',
            description: 'Total approved amount',
            optional: true,
            properties: {
              value: { type: 'number', description: 'Amount value', optional: true },
              currency: { type: 'string', description: 'Currency code', optional: true },
            },
          },
          totalPostedAmount: {
            type: 'json',
            description: 'Total posted amount',
            optional: true,
            properties: {
              value: { type: 'number', description: 'Amount value', optional: true },
              currency: { type: 'string', description: 'Currency code', optional: true },
            },
          },
          totalRemainingAmount: {
            type: 'json',
            description: 'Total remaining amount',
            optional: true,
            properties: {
              value: { type: 'number', description: 'Amount value', optional: true },
              currency: { type: 'string', description: 'Currency code', optional: true },
            },
          },
          expenses: {
            type: 'array',
            description: 'Resource links to expected expenses',
            optional: true,
            items: { type: 'json' },
          },
          cashAdvances: {
            type: 'json',
            description: 'Resource link to cash advances',
            optional: true,
            properties: {
              id: { type: 'string', description: 'Resource ID', optional: true },
              href: { type: 'string', description: 'Resource hyperlink', optional: true },
            },
          },
          comments: {
            type: 'json',
            description: 'Resource link to comments',
            optional: true,
            properties: {
              id: { type: 'string', description: 'Resource ID', optional: true },
              href: { type: 'string', description: 'Resource hyperlink', optional: true },
            },
          },
          exceptions: {
            type: 'json',
            description: 'Resource link to exceptions',
            optional: true,
            properties: {
              id: { type: 'string', description: 'Resource ID', optional: true },
              href: { type: 'string', description: 'Resource hyperlink', optional: true },
            },
          },
          travelAgency: {
            type: 'json',
            description: 'Resource link to travel agency',
            optional: true,
            properties: {
              id: { type: 'string', description: 'Resource ID', optional: true },
              href: { type: 'string', description: 'Resource hyperlink', optional: true },
            },
          },
          extensionOf: {
            type: 'json',
            description: 'The Request for which this Request is an extension of, or addendum to',
            optional: true,
            properties: {
              requestId: {
                type: 'string',
                description: 'The public key of the Request (unique per customer)',
                optional: true,
              },
              id: {
                type: 'string',
                description: 'Unique identifier of the Request',
                optional: true,
              },
              href: { type: 'string', description: 'Hyperlink to the resource', optional: true },
              template: {
                type: 'string',
                description: 'Hyperlink template to the resource',
                optional: true,
              },
            },
          },
          expensePolicy: {
            type: 'json',
            description: 'Expense policy reference',
            optional: true,
            properties: {
              id: { type: 'string', description: 'Policy identifier', optional: true },
              href: { type: 'string', description: 'Policy URL', optional: true },
            },
          },
          operations: {
            type: 'array',
            description: 'Available follow-up workflow actions',
            optional: true,
            items: {
              type: 'json',
              properties: {
                rel: { type: 'string', description: 'Link relation', optional: true },
                href: { type: 'string', description: 'Link target', optional: true },
              },
            },
          },
        },
      },
    },
  }
