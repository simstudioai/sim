import {
  FIELD_OUTPUT_PROPERTIES,
  mapField,
  mapPagination,
  PAGINATION_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneFieldListResponse,
  type RocketlaneListFieldsParams,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneListFieldsTool: ToolConfig<
  RocketlaneListFieldsParams,
  RocketlaneFieldListResponse
> = {
  id: 'rocketlane_list_fields',
  name: 'Rocketlane List Fields',
  description:
    'List fields in your Rocketlane account, with optional filters, sorting, and pagination',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of fields per page',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token returned by a previous request (valid for 15 minutes)',
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
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Property to sort by (supported: fieldLabel)',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order (ASC or DESC)',
    },
    match: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether results must match all filters or any filter (all or any)',
    },
    objectType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by associated object type (PROJECT, TASK, or USER)',
    },
    fieldType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by field type (TEXT, MULTI_LINE_TEXT, YES_OR_NO, DATE, SINGLE_CHOICE, MULTIPLE_CHOICE, SINGLE_USER, MULTIPLE_USER, NUMBER, NOTE, RATING)',
    },
    enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by enabled state',
    },
    private: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by privacy setting',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/fields`)
      if (params.pageSize != null) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      if (params.includeFields) url.searchParams.set('includeFields', params.includeFields)
      if (params.includeAllFields != null) {
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      }
      if (params.sortBy) url.searchParams.set('sortBy', params.sortBy)
      if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder)
      if (params.match) url.searchParams.set('match', params.match)
      if (params.objectType) url.searchParams.set('objectType.eq', params.objectType)
      if (params.fieldType) url.searchParams.set('fieldType.eq', params.fieldType)
      if (params.enabled != null) url.searchParams.set('enabled.eq', String(params.enabled))
      if (params.private != null) url.searchParams.set('private.eq', String(params.private))
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
    const fields = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        fields: fields.map(mapField),
        pagination: mapPagination(data?.pagination),
      },
    }
  },

  outputs: {
    fields: {
      type: 'array',
      description: 'List of fields',
      items: { type: 'object', properties: FIELD_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details for the result set',
      properties: PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
