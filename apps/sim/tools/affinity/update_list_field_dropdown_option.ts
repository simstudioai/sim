import type {
  AffinityAcknowledgementResponse,
  AffinityUpdateListFieldDropdownOptionParams,
} from '@/tools/affinity/types'
import { ACKNOWLEDGEMENT_OUTPUTS } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  buildUpdateDropdownOptionBody,
  requireId,
  requireParam,
  transformAcknowledgement,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityUpdateListFieldDropdownOptionTool: ToolConfig<
  AffinityUpdateListFieldDropdownOptionParams,
  AffinityAcknowledgementResponse
> = {
  id: 'affinity_update_list_field_dropdown_option',
  name: 'Affinity Update List Field Dropdown Option',
  description:
    "Change a dropdown option on a list field. Every field is optional — supply only what should change, and only fields the option's kind actually has.",
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
    dropdownOptionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The dropdown option ID to update',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement option label. Supply at least one field to change',
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
      const optionId = encodeURIComponent(requireId(params.dropdownOptionId, 'dropdownOptionId'))
      return buildAffinityUrl(`/lists/${listId}/fields/${fieldId}/dropdown-options/${optionId}`)
    },
    method: 'POST',
    headers: (params) => affinityHeaders(params.apiKey, true),
    body: (params) => buildUpdateDropdownOptionBody(params),
  },

  transformResponse: transformAcknowledgement((params) => String(params.dropdownOptionId ?? '')),

  outputs: ACKNOWLEDGEMENT_OUTPUTS,
}
