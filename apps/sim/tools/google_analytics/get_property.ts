import {
  extractGoogleApiError,
  type GoogleAnalyticsGetPropertyParams,
  type GoogleAnalyticsGetPropertyResponse,
  normalizePropertyName,
  toProperty,
} from '@/tools/google_analytics/types'
import type { ToolConfig } from '@/tools/types'

export const googleAnalyticsGetPropertyTool: ToolConfig<
  GoogleAnalyticsGetPropertyParams,
  GoogleAnalyticsGetPropertyResponse
> = {
  id: 'google_analytics_get_property',
  name: 'Get Google Analytics Property',
  description:
    'Get the configuration of a single Google Analytics 4 property, including its time zone and currency',
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
    propertyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GA4 property ID (e.g. 123456789)',
    },
  },

  request: {
    url: (params) =>
      `https://analyticsadmin.googleapis.com/v1beta/${normalizePropertyName(params.propertyId)}`,
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
        output: { property: null },
        error: extractGoogleApiError(data),
      }
    }

    return {
      success: true,
      output: { property: toProperty(data) },
    }
  },

  outputs: {
    property: {
      type: 'json',
      description: 'The property configuration',
      nullable: true,
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
}
