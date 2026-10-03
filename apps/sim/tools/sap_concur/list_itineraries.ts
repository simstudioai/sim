import type { ListItinerariesParams, SapConcurResponse } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  buildListQuery,
  transformSapConcurResponse,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

/**
 * Concur Trips v1.1 serves this endpoint as XML only — there is no JSON representation.
 * The direct operation therefore surfaces the payload as a raw XML string in `data`, which
 * downstream blocks are expected to parse.
 */
export const listItinerariesTool: InternalToolConfig<ListItinerariesParams, SapConcurResponse> = {
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
      description:
        'Filter by booking type. Supported values are capitalized: Air, Car, Dining, Hotel, Parking, Rail, Ride.',
    },
    useridType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'User identifier type. The only value documented for Trips v1.1 is "login" (the value is the user login id); xmlsyncid and uuid are Travel Profile v2 identifier types and are not documented for this endpoint.',
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
      description:
        'Items per page. Concur only paginates when includeMetadata is also sent, so this tool sets includeMetadata automatically whenever itemsPerPage or page is provided.',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        '1-based page number. Concur only paginates when includeMetadata is also sent, so this tool sets includeMetadata automatically whenever page or itemsPerPage is provided.',
    },
    includeMetadata: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Include paging metadata in the response. Implied when page or itemsPerPage is set.',
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
    includeVirtualTrip: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to "1" to include virtual trips, which carry the offline segments booked through Concur Request.',
    },
    includeGuestBookings: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include trips booked on behalf of guests. Defaults to false.',
    },
  },
  operation: {
    input: (params) => {
      const isPaged = params.itemsPerPage !== undefined || params.page !== undefined
      const query = buildListQuery({
        startDate: params.startDate,
        endDate: params.endDate,
        bookingType: params.bookingType,
        userid_type: params.useridType,
        userid_value: params.useridValue,
        ItemsPerPage: params.itemsPerPage,
        Page: params.page,
        includeMetadata: isPaged ? true : params.includeMetadata,
        includeVirtualTrip: params.includeVirtualTrip,
        includeGuestBookings: params.includeGuestBookings,
        includeCanceledTrips: params.includeCanceledTrips,
        createdAfterDate: params.createdAfterDate,
        createdBeforeDate: params.createdBeforeDate,
        lastModifiedDate: params.lastModifiedDate,
      })
      return {
        ...baseSapConcurInput(params),
        path: `/api/travel/trip/v1.1`,
        method: 'GET',
        accept: 'application/xml',
        ...(Object.keys(query).length > 0 ? { query } : {}),
      }
    },
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'string',
      description:
        'Raw XML trips list returned by Concur (Trips v1.1 emits application/xml only, so this is a string and not a parsed object). By default the document is rooted at <ItineraryInfoList> containing one <ItineraryInfo> per trip (TripId, TripName, TripStatus, StartDateLocal, EndDateLocal, DateModifiedUtc, UserLoginId, id). When includeMetadata is sent — which this tool does automatically whenever page or itemsPerPage is supplied — the document is instead rooted at <ConnectResponse> with ConnectResponse > Metadata > Paging (TotalPages, TotalItems, Page, ItemsPerPage, PreviousPageURL, NextPageURL) and ConnectResponse > Data > ItineraryInfoList > ItineraryInfo.',
    },
  },
}
