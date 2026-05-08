import type { CreateExpectedExpenseParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const createExpectedExpenseTool: ToolConfig<
  CreateExpectedExpenseParams,
  SapConcurProxyResponse
> = {
  id: 'sap_concur_create_expected_expense',
  name: 'SAP Concur Create Expected Expense',
  description:
    'Create an expected expense on a travel request (POST /travelrequest/v4/requests/{requestUuid}/expenses).',
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
      description:
        'User UUID acting on the request (required when using a Company JWT, optional otherwise)',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expected expense payload',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const requestUuid = trimRequired(params.requestUuid, 'requestUuid')
      const query: Record<string, string> = {}
      if (params.userId?.trim()) query.userId = params.userId.trim()
      return {
        ...baseProxyBody(params),
        path: `/travelrequest/v4/requests/${encodeURIComponent(requestUuid)}/expenses`,
        method: 'POST',
        body: params.body,
        ...(Object.keys(query).length > 0 ? { query } : {}),
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Created expected expense payload',
      properties: {
        id: { type: 'string', description: 'Expected expense identifier', optional: true },
        href: { type: 'string', description: 'Self-link to the resource', optional: true },
        expenseType: {
          type: 'json',
          description: 'Expense type {id, name}',
          optional: true,
        },
        transactionDate: {
          type: 'string',
          description: 'Transaction date',
          optional: true,
        },
        transactionAmount: {
          type: 'json',
          description: 'Transaction amount {value, currencyCode}',
          optional: true,
        },
        postedAmount: {
          type: 'json',
          description: 'Posted amount {value, currencyCode}',
          optional: true,
        },
        approvedAmount: {
          type: 'json',
          description: 'Approved amount {value, currencyCode}',
          optional: true,
        },
        remainingAmount: {
          type: 'json',
          description: 'Remaining amount on the expected expense',
          optional: true,
        },
        businessPurpose: {
          type: 'string',
          description: 'Business purpose of the expense',
          optional: true,
        },
        location: {
          type: 'json',
          description:
            'Location {id, name, city, countryCode, countrySubDivisionCode, iataCode, locationType}',
          optional: true,
        },
        exchangeRate: {
          type: 'json',
          description: 'Exchange rate {value, operation}',
          optional: true,
        },
        allocations: {
          type: 'json',
          description:
            'Budget allocations array (allocationId, allocationAmount, approvedAmount, postedAmount, expenseId, percentEdited, systemAllocation, percentage)',
          optional: true,
        },
        tripData: {
          type: 'json',
          description:
            'Trip data {agencyBooked, selfBooked, tripType (ONE_WAY|ROUND_TRIP), legs[{id, returnLeg, startDate, startTime, startLocationDetail, startLocation, endLocation, class {code,value}, travelExceptionReasonCodes}], segmentType {category, code}}',
          optional: true,
        },
        parentRequest: {
          type: 'json',
          description: 'Parent travel request resource link {href, id}',
          optional: true,
        },
        comments: {
          type: 'json',
          description: 'Comments sub-resource link {href, id}',
          optional: true,
        },
      },
    },
  },
}
