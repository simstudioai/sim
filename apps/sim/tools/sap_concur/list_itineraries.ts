import type { ListItinerariesParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  buildListQuery,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const listItinerariesTool: ToolConfig<ListItinerariesParams, SapConcurProxyResponse> = {
  id: 'sap_concur_list_itineraries',
  name: 'SAP Concur List Trips',
  description: 'List travel trips/itineraries (GET /api/travel/trip/v1.1).',
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
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter trips starting on/after this date (YYYY-MM-DD)',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter trips ending on/before this date (YYYY-MM-DD)',
    },
    bookingType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by booking type (air, car, hotel, rail, etc.)',
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
    itemsPerPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Items per page',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: '1-based page number',
    },
    includeMetadata: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include paging metadata in the response',
    },
    includeCanceledTrips: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include canceled trips in the result set',
    },
    createdAfterDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only trips created after this date (YYYY-MM-DD)',
    },
    createdBeforeDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only trips created before this date (YYYY-MM-DD)',
    },
    lastModifiedDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only trips modified on/after this date (YYYY-MM-DD)',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const query = buildListQuery({
        startDate: params.startDate,
        endDate: params.endDate,
        bookingType: params.bookingType,
        userid_type: params.useridType,
        userid_value: params.useridValue,
        ItemsPerPage: params.itemsPerPage,
        Page: params.page,
        includeMetadata: params.includeMetadata,
        includeCanceledTrips: params.includeCanceledTrips,
        createdAfterDate: params.createdAfterDate,
        createdBeforeDate: params.createdBeforeDate,
        lastModifiedDate: params.lastModifiedDate,
      })
      return {
        ...baseProxyBody(params),
        path: `/api/travel/trip/v1.1`,
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
      description: 'Trips list payload (Itinerary v1.1 ConnectResponse)',
      properties: {
        Metadata: {
          type: 'json',
          description: 'Paging metadata (when includeMetadata=true)',
          optional: true,
          properties: {
            Paging: {
              type: 'json',
              description: 'Pagination details',
              optional: true,
              properties: {
                TotalPages: { type: 'number', description: 'Total pages', optional: true },
                TotalItems: { type: 'number', description: 'Total items', optional: true },
                Page: { type: 'number', description: 'Current page', optional: true },
                ItemsPerPage: { type: 'number', description: 'Items per page', optional: true },
                PreviousPageURL: {
                  type: 'string',
                  description: 'Previous page URL',
                  optional: true,
                },
                NextPageURL: { type: 'string', description: 'Next page URL', optional: true },
              },
            },
          },
        },
        ItineraryInfoList: {
          type: 'array',
          description: 'List of itinerary summary records',
          optional: true,
          items: {
            type: 'json',
            properties: {
              ItinLocator: {
                type: 'string',
                description: 'Trip locator (trip ID)',
                optional: true,
              },
              ClientLocator: { type: 'string', description: 'Client trip locator', optional: true },
              ItinSourceName: {
                type: 'string',
                description: 'Booking source name',
                optional: true,
              },
              BookedVia: { type: 'string', description: 'Booking channel', optional: true },
              TripName: { type: 'string', description: 'Trip name', optional: true },
              Status: { type: 'string', description: 'Trip status', optional: true },
              Description: { type: 'string', description: 'Trip description', optional: true },
              StartDateUtc: { type: 'string', description: 'Start (UTC)', optional: true },
              EndDateUtc: { type: 'string', description: 'End (UTC)', optional: true },
              StartDateLocal: { type: 'string', description: 'Start (local)', optional: true },
              EndDateLocal: { type: 'string', description: 'End (local)', optional: true },
              DateCreatedUtc: { type: 'string', description: 'Created (UTC)', optional: true },
              DateModifiedUtc: { type: 'string', description: 'Modified (UTC)', optional: true },
              DateBookedLocal: { type: 'string', description: 'Booked (local)', optional: true },
              UserLoginId: { type: 'string', description: 'Trip owner login id', optional: true },
              BookedByFirstName: {
                type: 'string',
                description: 'Booker first name',
                optional: true,
              },
              BookedByLastName: { type: 'string', description: 'Booker last name', optional: true },
              IsPersonal: { type: 'boolean', description: 'Personal trip flag', optional: true },
            },
          },
        },
      },
    },
  },
}
