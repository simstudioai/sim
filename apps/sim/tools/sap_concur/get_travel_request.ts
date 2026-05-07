import type { GetTravelRequestParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getTravelRequestTool: ToolConfig<GetTravelRequestParams, SapConcurProxyResponse> = {
  id: 'sap_concur_get_travel_request',
  name: 'SAP Concur Get Travel Request',
  description: 'Get a single travel request (GET /travelrequest/v4/requests/{requestUuid}).',
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
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional Concur user UUID — required when impersonating another user',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const requestUuid = trimRequired(params.requestUuid, 'requestUuid')
      const query: Record<string, string> = {}
      if (params.userId) query.userId = params.userId
      return {
        ...baseProxyBody(params),
        path: `/travelrequest/v4/requests/${encodeURIComponent(requestUuid)}`,
        method: 'GET',
        query: Object.keys(query).length > 0 ? query : undefined,
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Travel request detail payload',
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
        pnr: { type: 'string', description: 'Passenger record number', optional: true },
        approved: {
          type: 'boolean',
          description: 'Whether the request is approved',
          optional: true,
        },
        pendingApproval: { type: 'boolean', description: 'Pending approval flag', optional: true },
        closed: { type: 'boolean', description: 'Closed flag', optional: true },
        everSentBack: { type: 'boolean', description: 'Ever-sent-back flag', optional: true },
        canceledPostApproval: {
          type: 'boolean',
          description: 'Canceled after approval flag',
          optional: true,
        },
        isParentRequest: { type: 'boolean', description: 'Parent request flag', optional: true },
        parentRequestId: {
          type: 'string',
          description: 'Parent budget request ID',
          optional: true,
        },
        allocationFormId: {
          type: 'string',
          description: 'Allocation form identifier',
          optional: true,
        },
        highestExceptionLevel: {
          type: 'string',
          description: 'Highest exception level (WARNING, ERROR, NONE)',
          optional: true,
        },
        approvalStatus: {
          type: 'json',
          description: 'Approval status',
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
          description: 'Approver assigned to the request',
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
        parentRequest: {
          type: 'json',
          description: 'Resource link to parent request',
          optional: true,
          properties: {
            id: { type: 'string', description: 'Resource ID', optional: true },
            href: { type: 'string', description: 'Resource hyperlink', optional: true },
          },
        },
        eventRequest: {
          type: 'json',
          description: 'Resource link to parent event request',
          optional: true,
          properties: {
            id: { type: 'string', description: 'Resource ID', optional: true },
            href: { type: 'string', description: 'Resource hyperlink', optional: true },
          },
        },
        operations: {
          type: 'array',
          description: 'Available workflow actions',
          optional: true,
          items: {
            type: 'json',
            properties: {
              rel: { type: 'string', description: 'Operation name', optional: true },
              href: { type: 'string', description: 'Operation URL', optional: true },
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
        custom1: { type: 'json', description: 'Custom field 1', optional: true },
        custom2: { type: 'json', description: 'Custom field 2', optional: true },
        custom3: { type: 'json', description: 'Custom field 3', optional: true },
        custom4: { type: 'json', description: 'Custom field 4', optional: true },
      },
    },
  },
}
