import type { CreateTravelRequestParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const createTravelRequestTool: ToolConfig<
  CreateTravelRequestParams,
  SapConcurProxyResponse
> = {
  id: 'sap_concur_create_travel_request',
  name: 'SAP Concur Create Travel Request',
  description: 'Create a travel request (POST /travelrequest/v4/requests).',
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'Concur user UUID of the Request owner — required when using the default `client_credentials` (company) grant; omitting it returns 400 `missingRequiredParam`.',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Travel request payload. Supported fields: name, businessPurpose, startDate/endDate (YYYY-MM-DD), startTime/endTime (HH:mm), mainDestination ({ city, countryCode, countrySubDivisionCode, name }), policy ({ id }), and custom1-custom20 ({ value } or { code, value }). An id field is not allowed.',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const query: Record<string, string> = {}
      const userId = params.userId?.trim()
      if (userId) query.userId = userId
      return {
        ...baseProxyBody(params),
        path: `/travelrequest/v4/requests`,
        method: 'POST',
        body: params.body,
        query: Object.keys(query).length > 0 ? query : undefined,
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Created travel request payload',
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
        startDate: { type: 'string', description: 'Trip start date (ISO 8601)', optional: true },
        endDate: { type: 'string', description: 'Trip end date (ISO 8601)', optional: true },
        startTime: { type: 'string', description: 'Trip start time (HH:mm)', optional: true },
        endTime: { type: 'string', description: 'Trip end time (HH:mm)', optional: true },
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
        expenses: {
          type: 'array',
          description: 'Expected expenses attached to the request',
          optional: true,
          items: { type: 'json' },
        },
        highestExceptionLevel: {
          type: 'string',
          description: 'Highest exception level (NONE, WARNING, ERROR)',
          optional: true,
        },
        travelAgency: {
          type: 'json',
          description: 'Travel agency reference',
          optional: true,
          properties: {
            id: { type: 'string', description: 'Agency identifier', optional: true },
            href: { type: 'string', description: 'Agency URL', optional: true },
            template: { type: 'string', description: 'Template URL', optional: true },
          },
        },
        custom1: { type: 'json', description: 'Custom field 1', optional: true },
        custom2: { type: 'json', description: 'Custom field 2', optional: true },
        custom3: { type: 'json', description: 'Custom field 3', optional: true },
        custom4: { type: 'json', description: 'Custom field 4', optional: true },
        custom5: { type: 'json', description: 'Custom field 5', optional: true },
        custom6: { type: 'json', description: 'Custom field 6', optional: true },
        custom7: { type: 'json', description: 'Custom field 7', optional: true },
        custom8: { type: 'json', description: 'Custom field 8', optional: true },
        custom9: { type: 'json', description: 'Custom field 9', optional: true },
        custom10: { type: 'json', description: 'Custom field 10', optional: true },
        custom11: { type: 'json', description: 'Custom field 11', optional: true },
        custom12: { type: 'json', description: 'Custom field 12', optional: true },
        custom13: { type: 'json', description: 'Custom field 13', optional: true },
        custom14: { type: 'json', description: 'Custom field 14', optional: true },
        custom15: { type: 'json', description: 'Custom field 15', optional: true },
        custom16: { type: 'json', description: 'Custom field 16', optional: true },
        custom17: { type: 'json', description: 'Custom field 17', optional: true },
        custom18: { type: 'json', description: 'Custom field 18', optional: true },
        custom19: { type: 'json', description: 'Custom field 19', optional: true },
        custom20: { type: 'json', description: 'Custom field 20', optional: true },
      },
    },
  },
}
