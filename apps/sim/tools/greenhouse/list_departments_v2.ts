import type {
  GreenhouseListDepartmentsV2Params,
  GreenhouseListDepartmentsV2Response,
} from '@/tools/greenhouse/types'
import { DEPARTMENTS_V2_OUTPUTS, PAGE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListDepartmentsV2Tool: ToolConfig<
  GreenhouseListDepartmentsV2Params,
  GreenhouseListDepartmentsV2Response
> = {
  id: 'greenhouse_list_departments_v2',
  name: 'Greenhouse List Departments',
  description: 'Lists one page of departments with cursor pagination and documented filters.',
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
    parent_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent ID',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External ID',
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('departments', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: [
            'created_at',
            'external_id',
            'external_parent_id',
            'id',
            'name',
            'parent_id',
            'updated_at',
          ],
        },
        parent_id: { type: 'integer' },
        external_id: { type: 'string' },
      }),
    method: 'GET',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const rows = await readGreenhouseList(response)
    return {
      success: true,
      output: {
        departments: rows.map((row) => mapGreenhouseFields(row, DEPARTMENTS_V2_OUTPUTS)),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    departments: {
      type: 'array',
      description: 'departments on this page',
      items: { type: 'object', properties: { ...DEPARTMENTS_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
