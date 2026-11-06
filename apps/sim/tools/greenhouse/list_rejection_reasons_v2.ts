import type {
  GreenhouseListRejectionReasonsV2Params,
  GreenhouseListRejectionReasonsV2Response,
} from '@/tools/greenhouse/types'
import { PAGE_V2_OUTPUTS, REJECTION_REASONS_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListRejectionReasonsV2Tool: ToolConfig<
  GreenhouseListRejectionReasonsV2Params,
  GreenhouseListRejectionReasonsV2Response
> = {
  id: 'greenhouse_list_rejection_reasons_v2',
  name: 'Greenhouse List Rejection Reasons',
  description: 'Lists one page of rejection reasons with cursor pagination and documented filters.',
  version: '2.0.0',
  oauth: { required: true, provider: 'greenhouse' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Greenhouse OAuth access token',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Opaque nextCursor from the previous page. When set, all other filters and per_page are ignored.',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size from 1 to 500 (default 100). Each call retrieves one page.',
    },
    ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ids Comma-separated values (maximum 50).',
    },
    created_at: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Created at filter as JSON with gte, lte, gt, lt keys and ISO 8601 values, for example {"gte":"2026-01-01T00:00:00Z"}. Cannot be combined with updated_at.',
    },
    updated_at: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Updated at filter as JSON with gte, lte, gt, lt keys and ISO 8601 values, for example {"gte":"2026-01-01T00:00:00Z"}. Cannot be combined with created_at.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated response field names. Omit to return all documented fields. Comma-separated values (maximum 50).',
    },
    include_defaults: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include defaults',
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('rejection_reasons', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: ['created_at', 'id', 'name', 'type', 'updated_at'],
        },
        include_defaults: { type: 'boolean' },
      }),
    method: 'GET',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const rows = await readGreenhouseList(response)
    return {
      success: true,
      output: {
        rejection_reasons: rows.map((row) =>
          mapGreenhouseFields(row, REJECTION_REASONS_V2_OUTPUTS)
        ),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    rejection_reasons: {
      type: 'array',
      description: 'rejection reasons on this page',
      items: { type: 'object', properties: { ...REJECTION_REASONS_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
