import type { SapConcurProxyResponse, SearchLocationsParams } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

/** Localities v5 requires at least one of these selectors per request. */
const SELECTOR_PARAMS = ['searchText', 'locCode', 'locationNameId', 'locationNameKey'] as const

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
      description:
        'Free-text for location search. Conditional — required if none of locationNameKey, locationNameId, or locCode is present.',
    },
    locCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Location code. Conditional — required if none of locationNameKey, locationNameId, or searchText is present.',
    },
    locationNameId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'UUID identifier of the location name. Conditional — required if none of locationNameKey, locCode, or searchText is present.',
    },
    locationNameKey: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unique key for the location name. Conditional — required if none of locationNameId, locCode, or searchText is present.',
    },
    countryCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: '2-letter ISO 3166-1 country code. Only valid together with searchText.',
    },
    subdivisionCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO 3166-2:2007 country subdivision (e.g. US-WA). Only valid together with searchText.',
    },
    adminRegionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Administrative region ID. Only valid together with searchText.',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const query: Record<string, string | number> = {}
      const searchText = params.searchText?.trim()
      if (searchText) query.searchText = searchText
      if (params.locCode) query.locCode = params.locCode
      if (params.locationNameId) query.locationNameId = params.locationNameId
      if (params.locationNameKey !== undefined && params.locationNameKey !== null)
        query.locationNameKey = params.locationNameKey

      const selectors = SELECTOR_PARAMS.filter((key) => query[key] !== undefined)
      if (selectors.length === 0) {
        throw new Error(
          'search_locations requires at least one of: searchText, locCode, locationNameId, locationNameKey'
        )
      }
      const filters: string[] = []
      if (params.countryCode) filters.push('countryCode')
      if (params.subdivisionCode) filters.push('subdivisionCode')
      if (params.adminRegionId) filters.push('adminRegionId')
      if (filters.length > 0 && query.searchText === undefined) {
        throw new Error(
          `search_locations only accepts ${filters.join(', ')} together with searchText`
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
                type: 'number',
                description: 'Time zone offset of the location, in minutes (e.g. 60)',
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
                    legacyKey: {
                      type: 'number',
                      description: 'Legacy numeric name key',
                      optional: true,
                    },
                    langCode: { type: 'string', description: 'Language code', optional: true },
                    name: { type: 'string', description: 'Display name', optional: true },
                    active: {
                      type: 'boolean',
                      description: 'Whether the name is active',
                      optional: true,
                    },
                  },
                },
              },
              administrativeRegion: {
                type: 'json',
                description: 'Administrative region (e.g., metro area)',
                optional: true,
                properties: {
                  id: {
                    type: 'string',
                    description: 'Unique identifier of the admin region',
                    optional: true,
                  },
                  names: {
                    type: 'array',
                    description: 'Localized region names',
                    optional: true,
                    items: { type: 'json' },
                  },
                  countryCode: {
                    type: 'string',
                    description: 'ISO 3166-1 country code of the region',
                    optional: true,
                  },
                  subDivCode: {
                    type: 'string',
                    description: 'ISO 3166-2 subdivision code of the region',
                    optional: true,
                  },
                  links: {
                    type: 'array',
                    description: 'HATEOAS links',
                    optional: true,
                    items: { type: 'json' },
                  },
                },
              },
              country: {
                type: 'json',
                description: 'Country reference (Code schema)',
                optional: true,
                properties: {
                  code: { type: 'string', description: 'ISO country code', optional: true },
                  names: {
                    type: 'array',
                    description: 'Localized country names',
                    optional: true,
                    items: { type: 'json' },
                  },
                  links: {
                    type: 'array',
                    description: 'HATEOAS links',
                    optional: true,
                    items: { type: 'json' },
                  },
                },
              },
              subDivision: {
                type: 'json',
                description: 'Country subdivision (state/province, Code schema)',
                optional: true,
                properties: {
                  code: { type: 'string', description: 'ISO subdivision code', optional: true },
                  names: {
                    type: 'array',
                    description: 'Localized subdivision names',
                    optional: true,
                    items: { type: 'json' },
                  },
                  links: {
                    type: 'array',
                    description: 'HATEOAS links',
                    optional: true,
                    items: { type: 'json' },
                  },
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
