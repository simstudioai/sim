import type {
  AffinityCollectionResponse,
  AffinityListFieldDropdownOptionsParams,
} from '@/tools/affinity/types'
import { DROPDOWN_OPTION_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  AFFINITY_FIELD_ENTITY_TYPES,
  affinityHeaders,
  buildAffinityUrl,
  requireOneOf,
  requireParam,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListFieldDropdownOptionsTool: ToolConfig<
  AffinityListFieldDropdownOptionsParams,
  AffinityCollectionResponse<'options'>
> = {
  id: 'affinity_list_field_dropdown_options',
  name: 'Affinity List Field Dropdown Options',
  description:
    'List the selectable options on a dropdown or ranked-dropdown company or person field. Writing such a field needs the option ID, not its text.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    entityType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Which field family the field belongs to: companies or persons',
    },
    fieldId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The dropdown or ranked-dropdown field ID',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from a previous page, returned as nextCursor or prevCursor',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of items to return per page, 1-100. Defaults to 100',
    },
  },

  request: {
    url: (params) => {
      const entityType = requireOneOf(params.entityType, AFFINITY_FIELD_ENTITY_TYPES, 'entityType')
      const fieldId = encodeURIComponent(requireParam(params.fieldId, 'fieldId'))
      return buildAffinityUrl(`/${entityType}/fields/${fieldId}/dropdown-options`, {
        cursor: params.cursor,
        limit: params.limit,
      })
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('options'),

  outputs: {
    options: {
      type: 'array',
      description: 'Selectable options on the field',
      items: { type: 'object', properties: DROPDOWN_OPTION_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of rows on this page' },
    nextCursor: {
      type: 'string',
      nullable: true,
      description: 'Cursor for the next page, or null on the last page',
    },
    prevCursor: {
      type: 'string',
      nullable: true,
      description: 'Cursor for the previous page, or null on the first page',
    },
  },
}
