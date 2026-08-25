import {
  extractGoogleApiError,
  type GoogleAnalyticsListPropertiesParams,
  type GoogleAnalyticsListPropertiesResponse,
  type GoogleAnalyticsProperty,
  normalizeAccountName,
  toBooleanParam,
  toOptionalNumberParam,
  toProperty,
} from '@/tools/google_analytics/types'
import type { ToolConfig } from '@/tools/types'

export const googleAnalyticsListPropertiesTool: ToolConfig<
  GoogleAnalyticsListPropertiesParams,
  GoogleAnalyticsListPropertiesResponse
> = {
  id: 'google_analytics_list_properties',
  name: 'List Google Analytics Properties',
  description: 'List the Google Analytics 4 properties under an account',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-analytics',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for the Google Analytics Admin API',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Analytics account ID to list properties for (e.g. 12345678)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Properties per page (default 50, max 200)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response',
    },
    showDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include soft-deleted properties',
    },
  },

  request: {
    /** `filter` is required by the API; `parent:` scopes the listing to one account. */
    url: (params) => {
      const query = new URLSearchParams({
        filter: `parent:${normalizeAccountName(params.accountId)}`,
      })
      const pageSize = toOptionalNumberParam(params.pageSize)
      if (pageSize !== undefined) query.set('pageSize', String(pageSize))
      if (params.pageToken) query.set('pageToken', params.pageToken)
      const showDeleted = toBooleanParam(params.showDeleted)
      if (showDeleted !== undefined) query.set('showDeleted', String(showDeleted))
      return `https://analyticsadmin.googleapis.com/v1beta/properties?${query.toString()}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: { properties: [], totalCount: 0, nextPageToken: null },
        error: extractGoogleApiError(data),
      }
    }

    const properties = (data.properties ?? [])
      .map((property: Record<string, unknown>) => toProperty(property))
      .filter((property: GoogleAnalyticsProperty | null): property is GoogleAnalyticsProperty =>
        Boolean(property)
      )

    return {
      success: true,
      output: {
        properties,
        totalCount: properties.length,
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    properties: {
      type: 'array',
      description: 'Properties under the account',
      items: {
        type: 'json',
        description: 'Property',
        properties: {
          name: { type: 'string', description: 'Resource name (properties/{id})' },
          displayName: { type: 'string', description: 'Property display name', nullable: true },
          propertyType: { type: 'string', description: 'Property type', nullable: true },
          parent: { type: 'string', description: 'Parent account or property', nullable: true },
          account: { type: 'string', description: 'Owning account resource name', nullable: true },
          industryCategory: { type: 'string', description: 'Industry category', nullable: true },
          timeZone: { type: 'string', description: 'Reporting time zone', nullable: true },
          currencyCode: { type: 'string', description: 'Reporting currency', nullable: true },
          serviceLevel: {
            type: 'string',
            description: 'Standard or 360 service level',
            nullable: true,
          },
          createTime: { type: 'string', description: 'Creation timestamp', nullable: true },
          updateTime: { type: 'string', description: 'Last update timestamp', nullable: true },
          deleteTime: { type: 'string', description: 'Soft-delete timestamp', nullable: true },
          expireTime: {
            type: 'string',
            description: 'When a trashed property is permanently deleted',
            nullable: true,
          },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Number of properties returned on this page',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page of properties',
      nullable: true,
    },
  },
}
