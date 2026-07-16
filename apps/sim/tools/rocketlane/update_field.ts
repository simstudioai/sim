import {
  FIELD_OUTPUT_PROPERTIES,
  mapField,
  ROCKETLANE_API_BASE,
  type RocketlaneFieldResponse,
  type RocketlaneUpdateFieldParams,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneUpdateFieldTool: ToolConfig<
  RocketlaneUpdateFieldParams,
  RocketlaneFieldResponse
> = {
  id: 'rocketlane_update_field',
  name: 'Rocketlane Update Field',
  description:
    'Update the label, description, enabled state, or privacy of an existing Rocketlane field',
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
      description: 'ID of the field to update',
    },
    fieldLabel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name of the field',
    },
    fieldDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description of the field',
    },
    enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the field is enabled',
    },
    private: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the field is private',
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
    method: 'PUT',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => ({
      ...(params.fieldLabel != null && { fieldLabel: params.fieldLabel }),
      ...(params.fieldDescription != null && { fieldDescription: params.fieldDescription }),
      ...(params.enabled != null && { enabled: params.enabled }),
      ...(params.private != null && { private: params.private }),
    }),
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
      description: 'The updated field',
      properties: FIELD_OUTPUT_PROPERTIES,
    },
  },
}
