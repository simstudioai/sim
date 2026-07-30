import {
  FIELD_OUTPUT_PROPERTIES,
  mapField,
  ROCKETLANE_API_BASE,
  type RocketlaneFieldResponse,
  type RocketlaneGetFieldParams,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneGetFieldTool: ToolConfig<RocketlaneGetFieldParams, RocketlaneFieldResponse> =
  {
    id: 'rocketlane_get_field',
    name: 'Rocketlane Get Field',
    description: 'Retrieve a single Rocketlane field by ID',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Rocketlane API key',
      },
      fieldId: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the field to retrieve',
      },
      includeFields: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated extra field properties to include in the response (supported: options)',
      },
      includeAllFields: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to return all field properties in the response',
      },
    },

    request: {
      url: (params) => {
        const url = new URL(
          `${ROCKETLANE_API_BASE}/fields/${encodeURIComponent(String(params.fieldId))}`
        )
        if (params.includeFields) url.searchParams.set('includeFields', params.includeFields)
        if (params.includeAllFields != null) {
          url.searchParams.set('includeAllFields', String(params.includeAllFields))
        }
        return url.toString()
      },
      method: 'GET',
      headers: (params) => rocketlaneHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        throw new Error(await rocketlaneError(response))
      }
      const data = await response.json()
      return {
        success: true,
        output: { field: mapField(data) },
      }
    },

    outputs: {
      field: {
        type: 'object',
        description: 'The requested field',
        properties: FIELD_OUTPUT_PROPERTIES,
      },
    },
  }
