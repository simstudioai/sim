import type { GetItineraryParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  buildListQuery,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getItineraryTool: ToolConfig<GetItineraryParams, SapConcurProxyResponse> = {
  id: 'sap_concur_get_itinerary',
  name: 'SAP Concur Get Trip',
  description: 'Get a single trip/itinerary (GET /api/travel/trip/v1.1/{tripID}).',
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
    tripId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Trip ID',
    },
    useridType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User identifier type (login, xmlsyncid, uuid)',
    },
    useridValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User identifier value (paired with useridType)',
    },
    systemFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional system format (e.g., GDS) for the response',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const tripId = trimRequired(params.tripId, 'tripId')
      const query = buildListQuery({
        userid_type: params.useridType,
        userid_value: params.useridValue,
        systemFormat: params.systemFormat,
      })
      return {
        ...baseProxyBody(params),
        path: `/api/travel/trip/v1.1/${encodeURIComponent(tripId)}`,
        method: 'GET',
        ...(Object.keys(query).length > 0 ? { query } : {}),
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Trip detail payload (Itinerary v1.1)',
      properties: {
        ItinLocator: {
          type: 'string',
          description: 'Concur trip locator (trip ID)',
          optional: true,
        },
        ClientLocator: {
          type: 'string',
          description: 'Client (booking source) trip locator',
          optional: true,
        },
        ItinSourceName: {
          type: 'string',
          description: 'Booking source name',
          optional: true,
        },
        BookedVia: {
          type: 'string',
          description: 'How the trip was booked (e.g. ConcurTravel, Direct)',
          optional: true,
        },
        TripName: {
          type: 'string',
          description: 'Trip name',
          optional: true,
        },
        Status: {
          type: 'string',
          description: 'Trip status (e.g. Confirmed, Cancelled)',
          optional: true,
        },
        Description: {
          type: 'string',
          description: 'Trip description',
          optional: true,
        },
        Comments: {
          type: 'string',
          description: 'Comments attached to the trip',
          optional: true,
        },
        CancelComments: {
          type: 'string',
          description: 'Cancellation comments (when applicable)',
          optional: true,
        },
        ProjectName: {
          type: 'string',
          description: 'Associated project name',
          optional: true,
        },
        StartDateUtc: {
          type: 'string',
          description: 'Trip start datetime in UTC',
          optional: true,
        },
        EndDateUtc: {
          type: 'string',
          description: 'Trip end datetime in UTC',
          optional: true,
        },
        StartDateLocal: {
          type: 'string',
          description: 'Trip start datetime in local time',
          optional: true,
        },
        EndDateLocal: {
          type: 'string',
          description: 'Trip end datetime in local time',
          optional: true,
        },
        DateCreatedUtc: {
          type: 'string',
          description: 'Trip creation timestamp (UTC)',
          optional: true,
        },
        DateModifiedUtc: {
          type: 'string',
          description: 'Trip last-modified timestamp (UTC)',
          optional: true,
        },
        DateBookedLocal: {
          type: 'string',
          description: 'Booking date in local time',
          optional: true,
        },
        UserLoginId: {
          type: 'string',
          description: 'Login id of the trip owner',
          optional: true,
        },
        BookedByFirstName: {
          type: 'string',
          description: 'First name of the booker',
          optional: true,
        },
        BookedByLastName: {
          type: 'string',
          description: 'Last name of the booker',
          optional: true,
        },
        IsPersonal: {
          type: 'boolean',
          description: 'Whether the trip is flagged personal',
          optional: true,
        },
        RuleViolations: {
          type: 'array',
          description: 'Travel rule violations attached to the trip',
          optional: true,
          items: { type: 'json' },
        },
        Bookings: {
          type: 'array',
          description: 'Bookings (air/hotel/car/rail) attached to the trip',
          optional: true,
          items: { type: 'json' },
        },
      },
    },
  },
}
