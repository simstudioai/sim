import type { GetTravelProfileParams, SapConcurResponse } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  buildListQuery,
  transformSapConcurResponse,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

/**
 * Travel Profile v2 serves this endpoint as XML only (Content-Type: application/xml, schema
 * TravelUserProfile.xsd) — there is no JSON representation. The direct operation therefore surfaces
 * the payload as a raw XML string in `data`, which downstream blocks are expected to parse.
 */
export const getTravelProfileTool: InternalToolConfig<GetTravelProfileParams, SapConcurResponse> = {
  id: 'sap_concur_get_travel_profile',
  name: 'SAP Concur Get Travel Profile',
  description:
    'Get a travel profile (GET /api/travelprofile/v2.0/profile). Returns the calling user by default; pass userid_type and userid_value to impersonate.',
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
    useridType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identifier type: login, xmlsyncid, or uuid',
    },
    useridValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identifier value (login id, xml sync id, or UUID)',
    },
  },
  operation: {
    input: (params) => {
      const query = buildListQuery({
        userid_type: params.useridType,
        userid_value: params.useridValue,
      })
      return {
        ...baseSapConcurInput(params),
        path: '/api/travelprofile/v2.0/profile',
        method: 'GET',
        accept: 'application/xml',
        query: Object.keys(query).length > 0 ? query : undefined,
      }
    },
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'string',
      description:
        'Raw XML travel profile document returned by Concur (Travel Profile v2 emits application/xml only, per the TravelUserProfile.xsd schema, so this is a string and not a parsed object). The Profile root element contains General, EmergencyContact, Telephones, Addresses, NationalIDs, DriversLicenses, HasNoPassport, Passports, Visas, EmailAddresses, RatePreferences, DiscountCodes, Air, Rail, Car, Hotel, CustomFields, Roles, Sponsors, TSAInfo, UnusedTickets, SouthwestUnusedTickets, and AdvantageMemberships. LoginId is an attribute of the <ProfileResponse> element returned by create/update, not a child element; XmlProfileSyncID and ProfileLastModifiedUTC belong to the Travel Profile summaries (ProfileSummary) response, not to this document.',
    },
  },
}
