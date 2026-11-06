import type {
  GreenhouseListProspectPoolStagesV2Params,
  GreenhouseListProspectPoolStagesV2Response,
} from '@/tools/greenhouse/types'
import { PAGE_V2_OUTPUTS, PROSPECT_POOL_STAGES_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListProspectPoolStagesV2Tool: ToolConfig<
  GreenhouseListProspectPoolStagesV2Params,
  GreenhouseListProspectPoolStagesV2Response
> = {
  id: 'greenhouse_list_prospect_pool_stages_v2',
  name: 'Greenhouse List Prospect Pool Stages',
  description:
    'Lists one page of prospect pool stages with cursor pagination and documented filters.',
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
    prospect_pool_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prospect pool IDs Comma-separated values (maximum 50).',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated response field names. Omit to return all documented fields. Comma-separated values (maximum 50).',
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('prospect_pool_stages', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        prospect_pool_ids: { type: 'csv', maxItems: 50, integerItems: true },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: ['created_at', 'id', 'name', 'prospect_pool_id', 'sort_order', 'updated_at'],
        },
      }),
    method: 'GET',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const rows = await readGreenhouseList(response)
    return {
      success: true,
      output: {
        prospect_pool_stages: rows.map((row) =>
          mapGreenhouseFields(row, PROSPECT_POOL_STAGES_V2_OUTPUTS)
        ),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    prospect_pool_stages: {
      type: 'array',
      description: 'prospect pool stages on this page',
      items: { type: 'object', properties: { ...PROSPECT_POOL_STAGES_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
