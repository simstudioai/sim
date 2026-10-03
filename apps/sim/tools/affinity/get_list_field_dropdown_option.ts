import type {
  AffinityEntityResponse,
  AffinityGetListFieldDropdownOptionParams,
} from '@/tools/affinity/types'
import { DROPDOWN_OPTION_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  requireParam,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityGetListFieldDropdownOptionTool: ToolConfig<
  AffinityGetListFieldDropdownOptionParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_get_list_field_dropdown_option',
  name: 'Affinity Get List Field Dropdown Option',
  description: 'Read one dropdown option on a list field.',
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
      description: 'The dropdown option ID',
    },
  },

  request: {
    url: (params) => {
      const listId = encodeURIComponent(requireId(params.listId, 'listId'))
      const fieldId = encodeURIComponent(requireParam(params.fieldId, 'fieldId'))
      const optionId = encodeURIComponent(requireId(params.dropdownOptionId, 'dropdownOptionId'))
      return buildAffinityUrl(`/lists/${listId}/fields/${fieldId}/dropdown-options/${optionId}`)
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformEntity(),

  outputs: DROPDOWN_OPTION_OUTPUT_PROPERTIES,
}
