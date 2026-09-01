import type {
  AffinityAcknowledgementResponse,
  AffinityDeleteListFieldDropdownOptionParams,
} from '@/tools/affinity/types'
import { ACKNOWLEDGEMENT_OUTPUTS } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  requireParam,
  transformAcknowledgement,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityDeleteListFieldDropdownOptionTool: ToolConfig<
  AffinityDeleteListFieldDropdownOptionParams,
  AffinityAcknowledgementResponse
> = {
  id: 'affinity_delete_list_field_dropdown_option',
  name: 'Affinity Delete List Field Dropdown Option',
  description:
    'Permanently delete a dropdown option on a list field. Every list entry currently set to it is cleared, and those values cannot be recovered.',
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
      description: 'The dropdown option ID to delete',
    },
  },

  request: {
    url: (params) => {
      const listId = encodeURIComponent(requireId(params.listId, 'listId'))
      const fieldId = encodeURIComponent(requireParam(params.fieldId, 'fieldId'))
      const optionId = encodeURIComponent(requireId(params.dropdownOptionId, 'dropdownOptionId'))
      return buildAffinityUrl(`/lists/${listId}/fields/${fieldId}/dropdown-options/${optionId}`)
    },
    method: 'DELETE',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformAcknowledgement((params) => String(params.dropdownOptionId ?? '')),

  outputs: ACKNOWLEDGEMENT_OUTPUTS,
}
