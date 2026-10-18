import type {
  GreenhouseListOpeningsV2Params,
  GreenhouseListOpeningsV2Response,
} from '@/tools/greenhouse/types'
import { OPENINGS_V2_OUTPUTS, PAGE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListOpeningsV2Tool: ToolConfig<
  GreenhouseListOpeningsV2Params,
  GreenhouseListOpeningsV2Response
> = {
  id: 'greenhouse_list_openings_v2',
  name: 'Greenhouse List Openings',
  description: 'Lists one page of openings with cursor pagination and documented filters.',
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
    job_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job IDs Comma-separated values (maximum 50).',
    },
    application_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Application IDs Comma-separated values (maximum 50).',
    },
    close_reason_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Close reason IDs Comma-separated values (maximum 50).',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated response field names. Omit to return all documented fields. Comma-separated values (maximum 50).',
    },
    opened_at: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Opened at filter as JSON with gte, lte, gt, lt keys and ISO 8601 values, for example {"gte":"2026-01-01T00:00:00Z"}.',
    },
    closed_at: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Closed at filter as JSON with gte, lte, gt, lt keys and ISO 8601 values, for example {"gte":"2026-01-01T00:00:00Z"}.',
    },
    custom_field_option_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom field option ID',
    },
    open: { type: 'boolean', required: false, visibility: 'user-or-llm', description: 'Open' },
    opening_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Filter by the opening's identifier.",
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('openings', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        job_ids: { type: 'csv', maxItems: 50, integerItems: true },
        application_ids: { type: 'csv', maxItems: 50, integerItems: true },
        close_reason_ids: { type: 'csv', maxItems: 50, integerItems: true },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: [
            'application_id',
            'close_reason_id',
            'closed_at',
            'created_at',
            'custom_fields',
            'id',
            'job_id',
            'open',
            'opened_at',
            'opening_id',
            'sort_order',
            'target_start_on',
            'updated_at',
          ],
        },
        opened_at: { type: 'object' },
        closed_at: { type: 'object' },
        custom_field_option_id: { type: 'integer' },
        open: { type: 'boolean' },
        opening_id: { type: 'string' },
      }),
    method: 'GET',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const rows = await readGreenhouseList(response)
    return {
      success: true,
      output: {
        openings: rows.map((row) => mapGreenhouseFields(row, OPENINGS_V2_OUTPUTS)),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    openings: {
      type: 'array',
      description: 'openings on this page',
      items: { type: 'object', properties: { ...OPENINGS_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
