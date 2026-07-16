import {
  FIELD_OUTPUT_PROPERTIES,
  mapField,
  ROCKETLANE_API_BASE,
  type RocketlaneCreateFieldParams,
  type RocketlaneFieldResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneCreateFieldTool: ToolConfig<
  RocketlaneCreateFieldParams,
  RocketlaneFieldResponse
> = {
  id: 'rocketlane_create_field',
  name: 'Rocketlane Create Field',
  description:
    'Create a custom field in your Rocketlane account, with options for SINGLE_CHOICE and MULTIPLE_CHOICE field types',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    fieldLabel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the field',
    },
    fieldType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Type of the field (TEXT, MULTI_LINE_TEXT, YES_OR_NO, DATE, SINGLE_CHOICE, MULTIPLE_CHOICE, SINGLE_USER, MULTIPLE_USER, NUMBER, NOTE, RATING)',
    },
    objectType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object the field is associated with (PROJECT, TASK, or USER)',
    },
    fieldDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the field',
    },
    fieldOptions: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Options for SINGLE_CHOICE and MULTIPLE_CHOICE fields; the order provided is preserved',
      items: {
        type: 'object',
        properties: {
          optionLabel: { type: 'string', description: 'Display label of the option' },
          optionColor: {
            type: 'string',
            description:
              'Color of the option (RED, YELLOW, GREEN, TEAL, CYAN, BLUE, PURPLE, MAGENTA, GRAY, COOL_GRAY)',
          },
        },
      },
    },
    ratingScale: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of stars for RATING fields (THREE, FIVE, SEVEN, TEN)',
    },
    enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the field is enabled (defaults to true)',
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
      const url = new URL(`${ROCKETLANE_API_BASE}/fields`)
      if (params.includeFields) url.searchParams.set('includeFields', params.includeFields)
      if (params.includeAllFields != null) {
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      }
      return url.toString()
    },
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => ({
      fieldLabel: params.fieldLabel,
      fieldType: params.fieldType,
      objectType: params.objectType,
      ...(params.fieldDescription != null && { fieldDescription: params.fieldDescription }),
      ...(params.fieldOptions != null && { fieldOptions: params.fieldOptions }),
      ...(params.ratingScale != null && { ratingScale: params.ratingScale }),
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
      description: 'The created field',
      properties: FIELD_OUTPUT_PROPERTIES,
    },
  },
}
