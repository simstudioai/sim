import {
  FIELD_OPTION_OUTPUT_PROPERTIES,
  mapFieldOption,
  ROCKETLANE_API_BASE,
  type RocketlaneFieldOptionResponse,
  type RocketlaneUpdateFieldOptionParams,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneUpdateFieldOptionTool: ToolConfig<
  RocketlaneUpdateFieldOptionParams,
  RocketlaneFieldOptionResponse
> = {
  id: 'rocketlane_update_field_option',
  name: 'Rocketlane Update Field Option',
  description:
    'Update the label or color of an existing option on a SINGLE_CHOICE or MULTIPLE_CHOICE Rocketlane field',
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
      description: 'ID of the field the option belongs to',
    },
    optionValue: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier of the option to update',
    },
    optionLabel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New display label of the option',
    },
    optionColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New color of the option (RED, YELLOW, GREEN, TEAL, CYAN, BLUE, PURPLE, MAGENTA, GRAY, COOL_GRAY)',
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/fields/${encodeURIComponent(String(params.fieldId))}/update-option`,
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => ({
      optionValue: params.optionValue,
      ...(params.optionLabel != null && { optionLabel: params.optionLabel }),
      ...(params.optionColor != null && { optionColor: params.optionColor }),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: { option: mapFieldOption(data) },
    }
  },

  outputs: {
    option: {
      type: 'object',
      description: 'The updated field option',
      properties: FIELD_OPTION_OUTPUT_PROPERTIES,
    },
  },
}
