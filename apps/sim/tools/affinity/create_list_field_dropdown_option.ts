import type {
  AffinityCreateListFieldDropdownOptionParams,
  AffinityEntityResponse,
} from '@/tools/affinity/types'
import { DROPDOWN_OPTION_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  buildCreateDropdownOptionBody,
  requireId,
  requireParam,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityCreateListFieldDropdownOptionTool: ToolConfig<
  AffinityCreateListFieldDropdownOptionParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_create_list_field_dropdown_option',
  name: 'Affinity Create List Field Dropdown Option',
  description:
    'Add a selectable option to a dropdown field on a list. A ranked or status option also needs a rank and a color.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The list ID',
    },
    fieldId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The dropdown field ID on that list',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Kind of option to create, matching the field. dropdown takes only a label; ranked-dropdown also requires rank and color; status-dropdown additionally requires a status category. Sending a field the kind does not accept is rejected',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The option label',
    },
    rank: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order. Required on a ranked-dropdown or status-dropdown option',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Option color: white, gray, blue, green, purple, orange, or red. Required on a ranked-dropdown or status-dropdown option',
    },
    statusCategory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pipeline meaning of the option: open, won, lost, or on-hold. Status-dropdown options only',
    },
    winRate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expected win rate of the status. Status-dropdown options only',
    },
  },

  request: {
    url: (params) => {
      const listId = encodeURIComponent(requireId(params.listId, 'listId'))
      const fieldId = encodeURIComponent(requireParam(params.fieldId, 'fieldId'))
      return buildAffinityUrl(`/lists/${listId}/fields/${fieldId}/dropdown-options`)
    },
    method: 'POST',
    headers: (params) => affinityHeaders(params.apiKey, true),
    body: (params) => buildCreateDropdownOptionBody(params),
  },

  transformResponse: transformEntity(),

  outputs: DROPDOWN_OPTION_OUTPUT_PROPERTIES,
}
