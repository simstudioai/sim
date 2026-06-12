import type { SapConcurProxyResponse, SearchLocationsParams } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const searchLocationsTool: ToolConfig<SearchLocationsParams, SapConcurProxyResponse> = {
  id: 'sap_concur_search_locations',
  name: 'SAP Concur Search Locations',
  description: 'Search Concur location reference data (GET /localities/v5/locations).',
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
    searchText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text query (city, airport, landmark, etc.)',
    },
    locCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'IATA / location code',
    },
    locationNameId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Concur internal location name ID (UUID)',
    },
    locationNameKey: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Concur internal numeric location name key',
    },
    countryCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: '2-letter ISO 3166-1 country code',
    },
    subdivisionCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 3166-2:2007 country subdivision (e.g. US-WA)',
    },
    adminRegionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Administrative region ID',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const query: Record<string, string | number> = {}
      if (params.searchText) query.searchText = params.searchText
      if (params.locCode) query.locCode = params.locCode
      if (params.locationNameId) query.locationNameId = params.locationNameId
      if (params.locationNameKey !== undefined && params.locationNameKey !== null)
        query.locationNameKey = params.locationNameKey
      if (
        query.searchText === undefined &&
        query.locCode === undefined &&
        query.locationNameId === undefined &&
        query.locationNameKey === undefined
      ) {
        throw new Error(
          'search_locations requires at least one of: searchText, locCode, locationNameId, locationNameKey'
        )
      }
      if (params.countryCode) query.countryCode = params.countryCode
      if (params.subdivisionCode) query.subdivisionCode = params.subdivisionCode
      if (params.adminRegionId) query.adminRegionId = params.adminRegionId
      return {
        ...baseProxyBody(params),
        path: '/localities/v5/locations',
        method: 'GET',
        query,
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Localities v5 search response',
      properties: {
        locations: {
          type: 'array',
          description: 'Array of matching Location records',
          optional: true,
          items: {
            type: 'json',
            properties: {
              id: { type: 'string', description: 'Location ID (UUID)', optional: true },
              code: { type: 'string', description: 'IATA / location code', optional: true },
              legacyKey: {
                type: 'number',
                description: 'Legacy numeric location key',
                optional: true,
              },
              timeZoneOffset: {
                type: 'string',
                description: 'IANA timezone or UTC offset',
                optional: true,
              },
              active: {
                type: 'boolean',
                description: 'Whether the location is active',
                optional: true,
              },
              point: {
                type: 'json',
                description: 'Geographic coordinates',
                optional: true,
                properties: {
                  latitude: { type: 'number', description: 'Latitude', optional: true },
                  longitude: { type: 'number', description: 'Longitude', optional: true },
                },
              },
              names: {
                type: 'array',
                description: 'Localized location names',
                optional: true,
                items: {
                  type: 'json',
                  properties: {
                    id: { type: 'string', description: 'Name ID', optional: true },
                    key: { type: 'number', description: 'Numeric name key', optional: true },
                    locale: { type: 'string', description: 'Locale tag', optional: true },
                    name: { type: 'string', description: 'Display name', optional: true },
                  },
                },
              },
              administrativeRegion: {
                type: 'json',
                description: 'Administrative region (e.g., metro area)',
                optional: true,
                properties: {
                  id: { type: 'string', description: 'Region ID', optional: true },
                  name: { type: 'string', description: 'Region name', optional: true },
                },
              },
              country: {
                type: 'json',
                description: 'Country reference',
                optional: true,
                properties: {
                  id: { type: 'string', description: 'Country ID', optional: true },
                  code: { type: 'string', description: 'ISO country code', optional: true },
                  name: { type: 'string', description: 'Country name', optional: true },
                },
              },
              subDivision: {
                type: 'json',
                description: 'Country subdivision (state/province)',
                optional: true,
                properties: {
                  id: { type: 'string', description: 'Subdivision ID', optional: true },
                  code: { type: 'string', description: 'ISO subdivision code', optional: true },
                  name: { type: 'string', description: 'Subdivision name', optional: true },
                },
              },
              links: {
                type: 'array',
                description: 'HATEOAS links',
                optional: true,
                items: { type: 'json' },
              },
            },
          },
        },
      },
    },
  },
}
