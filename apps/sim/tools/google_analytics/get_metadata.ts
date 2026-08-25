import {
  extractGoogleApiError,
  type GoogleAnalyticsGetMetadataParams,
  type GoogleAnalyticsGetMetadataResponse,
  type GoogleAnalyticsMetadataField,
  normalizePropertyName,
  toBooleanParam,
} from '@/tools/google_analytics/types'
import type { ToolConfig } from '@/tools/types'

interface RawMetadataField {
  apiName?: string
  uiName?: string
  description?: string
  type?: string
  dataType?: string
  customDefinition?: boolean
  deprecatedApiNames?: string[]
}

/**
 * Normalizes a DimensionMetadata or MetricMetadata entry. Dimensions expose their
 * value type as `dataType`, metrics as `type`; both land on a single `type` field.
 */
function toMetadataField(raw: RawMetadataField): GoogleAnalyticsMetadataField {
  return {
    apiName: raw.apiName ?? '',
    uiName: raw.uiName ?? null,
    description: raw.description ?? null,
    type: raw.type ?? raw.dataType ?? null,
    customDefinition: raw.customDefinition ?? false,
    deprecatedApiNames: raw.deprecatedApiNames ?? [],
  }
}

export const googleAnalyticsGetMetadataTool: ToolConfig<
  GoogleAnalyticsGetMetadataParams,
  GoogleAnalyticsGetMetadataResponse
> = {
  id: 'google_analytics_get_metadata',
  name: 'Get Google Analytics Metadata',
  description:
    'List the dimensions and metrics available for reporting on a Google Analytics 4 property, including custom definitions',
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'GA4 property ID. Omit to return the universal metadata shared by every property',
    },
    customOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only custom dimensions and metrics registered to the property',
    },
  },

  request: {
    /**
     * Property `0` is the documented sentinel for universal metadata, so an omitted
     * property still returns the standard dimension and metric catalog.
     */
    url: (params) => {
      const property = params.propertyId ? normalizePropertyName(params.propertyId) : 'properties/0'
      return `https://analyticsdata.googleapis.com/v1beta/${property}/metadata`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: {
          name: null,
          dimensions: [],
          metrics: [],
          totalDimensions: 0,
          totalMetrics: 0,
        },
        error: extractGoogleApiError(data),
      }
    }

    let dimensions = (data.dimensions ?? []).map(toMetadataField)
    let metrics = (data.metrics ?? []).map(toMetadataField)

    if (toBooleanParam(params?.customOnly)) {
      dimensions = dimensions.filter(
        (field: GoogleAnalyticsMetadataField) => field.customDefinition
      )
      metrics = metrics.filter((field: GoogleAnalyticsMetadataField) => field.customDefinition)
    }

    return {
      success: true,
      output: {
        name: data.name ?? null,
        dimensions,
        metrics,
        totalDimensions: dimensions.length,
        totalMetrics: metrics.length,
      },
    }
  },

  outputs: {
    name: {
      type: 'string',
      description: 'Metadata resource name (properties/{id}/metadata)',
      nullable: true,
    },
    dimensions: {
      type: 'array',
      description: 'Dimensions available for reporting',
      items: {
        type: 'json',
        description: 'Dimension metadata',
        properties: {
          apiName: { type: 'string', description: 'Name used in report requests' },
          uiName: { type: 'string', description: 'Name shown in the GA4 UI', nullable: true },
          description: {
            type: 'string',
            description: 'What the dimension measures',
            nullable: true,
          },
          type: { type: 'string', description: 'Value data type', nullable: true },
          customDefinition: {
            type: 'boolean',
            description: 'Whether this is a property-specific custom dimension',
          },
          deprecatedApiNames: {
            type: 'array',
            description: 'Still-accepted deprecated names',
            items: { type: 'string', description: 'Deprecated API name' },
          },
        },
      },
    },
    metrics: {
      type: 'array',
      description: 'Metrics available for reporting',
      items: {
        type: 'json',
        description: 'Metric metadata',
        properties: {
          apiName: { type: 'string', description: 'Name used in report requests' },
          uiName: { type: 'string', description: 'Name shown in the GA4 UI', nullable: true },
          description: { type: 'string', description: 'What the metric measures', nullable: true },
          type: { type: 'string', description: 'Value data type', nullable: true },
          customDefinition: {
            type: 'boolean',
            description: 'Whether this is a property-specific custom metric',
          },
          deprecatedApiNames: {
            type: 'array',
            description: 'Still-accepted deprecated names',
            items: { type: 'string', description: 'Deprecated API name' },
          },
        },
      },
    },
    totalDimensions: {
      type: 'number',
      description: 'Number of dimensions returned',
    },
    totalMetrics: {
      type: 'number',
      description: 'Number of metrics returned',
    },
  },
}
