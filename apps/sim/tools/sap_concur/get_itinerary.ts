import type { GetItineraryParams, SapConcurResponse } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  buildListQuery,
  transformSapConcurResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

/**
 * Concur Trips v1.1 serves this endpoint as XML only — there is no JSON representation.
 * The direct operation therefore surfaces the payload as a raw XML string in `data`, which
 * downstream blocks are expected to parse.
 */
export const getItineraryTool: InternalToolConfig<GetItineraryParams, SapConcurResponse> = {
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
      description:
        'User identifier type. The only value documented for Trips v1.1 is "login" (the value is the user login id); xmlsyncid and uuid are Travel Profile v2 identifier types and are not documented for this endpoint.',
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
      description:
        'Optional response format. The only supported value is "Tripit", which returns a completely different XML document rooted at <Response><Trip> instead of the standard itinerary document.',
    },
  },
  operation: {
    input: (params) => {
      const tripId = trimRequired(params.tripId, 'tripId')
      const query = buildListQuery({
        userid_type: params.useridType,
        userid_value: params.useridValue,
        systemFormat: params.systemFormat,
      })
      return {
        ...baseSapConcurInput(params),
        path: `/api/travel/trip/v1.1/${encodeURIComponent(tripId)}`,
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
        'Raw XML trip document returned by Concur (Trips v1.1 emits application/xml only, so this is a string and not a parsed object). The document is rooted at <Itinerary> and contains id, ItinLocator, ClientLocator, ItinSourceName, BookedVia, TripName, Status, Description, Comments, CancelComments, ProjectName, StartDateUtc, EndDateUtc, StartDateLocal, EndDateLocal, DateCreatedUtc, DateModifiedUtc, DateBookedLocal, BookedByFirstName, BookedByLastName, IsPersonal, RuleViolations, and Bookings > Booking. When systemFormat=Tripit is passed the document is rooted at <Response><Trip> instead.',
    },
  },
}
