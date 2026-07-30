import {
  FIELD_OPTION_OUTPUT_PROPERTIES,
  mapFieldOption,
  ROCKETLANE_API_BASE,
  type RocketlaneAddFieldOptionParams,
  type RocketlaneFieldOptionResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneAddFieldOptionTool: ToolConfig<
  RocketlaneAddFieldOptionParams,
  RocketlaneFieldOptionResponse
> = {
  id: 'rocketlane_add_field_option',
  name: 'Rocketlane Add Field Option',
  description: 'Add a new option to an existing SINGLE_CHOICE or MULTIPLE_CHOICE Rocketlane field',
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
      description: 'ID of the field to add the option to',
    },
    optionLabel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display label of the new option',
    },
    optionColor: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Color of the new option (RED, YELLOW, GREEN, TEAL, CYAN, BLUE, PURPLE, MAGENTA, GRAY, COOL_GRAY)',
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/fields/${encodeURIComponent(String(params.fieldId))}/add-option`,
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => ({
      optionLabel: params.optionLabel,
      optionColor: params.optionColor,
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
      description: 'The created field option',
      properties: FIELD_OPTION_OUTPUT_PROPERTIES,
    },
  },
}
