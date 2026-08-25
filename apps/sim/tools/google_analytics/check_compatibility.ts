import {
  extractGoogleApiError,
  type GoogleAnalyticsCheckCompatibilityParams,
  type GoogleAnalyticsCheckCompatibilityResponse,
  type GoogleAnalyticsCompatibilityEntry,
  normalizePropertyName,
  toNameList,
} from '@/tools/google_analytics/types'
import type { ToolConfig } from '@/tools/types'

interface RawCompatibility {
  compatibility?: string
  dimensionMetadata?: { apiName?: string; uiName?: string }
  metricMetadata?: { apiName?: string; uiName?: string }
}

function toEntries(
  raw: RawCompatibility[] | undefined,
  key: 'dimensionMetadata' | 'metricMetadata'
): GoogleAnalyticsCompatibilityEntry[] {
  return (raw ?? []).map((entry) => ({
    apiName: entry?.[key]?.apiName ?? '',
    uiName: entry?.[key]?.uiName ?? null,
    compatibility: entry?.compatibility ?? null,
  }))
}

export const googleAnalyticsCheckCompatibilityTool: ToolConfig<
  GoogleAnalyticsCheckCompatibilityParams,
  GoogleAnalyticsCheckCompatibilityResponse
> = {
  id: 'google_analytics_check_compatibility',
  name: 'Check Google Analytics Compatibility',
  description:
    'Check which Google Analytics 4 dimensions and metrics can be combined in the same report',
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
      description: 'OAuth access token for the Google Analytics Data API',
    },
    propertyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GA4 property ID (e.g. 123456789)',
    },
    dimensions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated dimension API names to test together',
    },
    metrics: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated metric API names to test together',
    },
    compatibilityFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict the response to one compatibility status: COMPATIBLE or INCOMPATIBLE',
    },
  },

  request: {
    url: (params) =>
      `https://analyticsdata.googleapis.com/v1beta/${normalizePropertyName(params.propertyId)}:checkCompatibility`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const dimensions = toNameList(params.dimensions)
      const metrics = toNameList(params.metrics)
      if (dimensions.length === 0 && metrics.length === 0) {
        throw new Error('At least one dimension or metric is required')
      }

      const body: Record<string, unknown> = {}
      if (dimensions.length > 0) body.dimensions = dimensions.map((name) => ({ name }))
      if (metrics.length > 0) body.metrics = metrics.map((name) => ({ name }))
      if (params.compatibilityFilter) body.compatibilityFilter = params.compatibilityFilter

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: {
          dimensionCompatibilities: [],
          metricCompatibilities: [],
          incompatible: [],
        },
        error: extractGoogleApiError(data),
      }
    }

    const dimensionCompatibilities = toEntries(data.dimensionCompatibilities, 'dimensionMetadata')
    const metricCompatibilities = toEntries(data.metricCompatibilities, 'metricMetadata')

    return {
      success: true,
      output: {
        dimensionCompatibilities,
        metricCompatibilities,
        incompatible: [...dimensionCompatibilities, ...metricCompatibilities]
          .filter((entry) => entry.compatibility === 'INCOMPATIBLE')
          .map((entry) => entry.apiName),
      },
    }
  },

  outputs: {
    dimensionCompatibilities: {
      type: 'array',
      description: 'Compatibility verdict for each requested dimension',
      items: {
        type: 'json',
        description: 'Dimension compatibility',
        properties: {
          apiName: { type: 'string', description: 'Dimension API name' },
          uiName: { type: 'string', description: 'Name shown in the GA4 UI', nullable: true },
          compatibility: {
            type: 'string',
            description: 'COMPATIBLE or INCOMPATIBLE',
            nullable: true,
          },
        },
      },
    },
    metricCompatibilities: {
      type: 'array',
      description: 'Compatibility verdict for each requested metric',
      items: {
        type: 'json',
        description: 'Metric compatibility',
        properties: {
          apiName: { type: 'string', description: 'Metric API name' },
          uiName: { type: 'string', description: 'Name shown in the GA4 UI', nullable: true },
          compatibility: {
            type: 'string',
            description: 'COMPATIBLE or INCOMPATIBLE',
            nullable: true,
          },
        },
      },
    },
    incompatible: {
      type: 'array',
      description: 'API names that cannot be combined with the rest of the request',
      items: { type: 'string', description: 'Incompatible dimension or metric API name' },
    },
  },
}
