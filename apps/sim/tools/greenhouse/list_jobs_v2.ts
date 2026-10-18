import type {
  GreenhouseListJobsV2Params,
  GreenhouseListJobsV2Response,
} from '@/tools/greenhouse/types'
import { JOBS_V2_OUTPUTS, PAGE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListJobsV2Tool: ToolConfig<
  GreenhouseListJobsV2Params,
  GreenhouseListJobsV2Response
> = {
  id: 'greenhouse_list_jobs_v2',
  name: 'Greenhouse List Jobs',
  description: 'Lists one page of jobs with cursor pagination and documented filters.',
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
    requisition_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Requisition ID',
    },
    department_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Department ID',
    },
    office_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Office ID',
    },
    custom_field_option_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom field option ID',
    },
    confidential: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Confidential',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status Allowed: open, draft, closed.',
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('jobs', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: [
            'closed_at',
            'confidential',
            'copied_from_id',
            'created_at',
            'custom_fields',
            'department_id',
            'external_department_id',
            'external_office_ids',
            'id',
            'is_template',
            'name',
            'notes',
            'office_ids',
            'opened_at',
            'requisition_id',
            'status',
            'updated_at',
          ],
        },
        opened_at: { type: 'object' },
        closed_at: { type: 'object' },
        requisition_id: { type: 'string' },
        department_id: { type: 'integer' },
        office_id: { type: 'integer' },
        custom_field_option_id: { type: 'integer' },
        confidential: { type: 'boolean' },
        status: { type: 'string', enum: ['open', 'draft', 'closed'] },
      }),
    method: 'GET',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const rows = await readGreenhouseList(response)
    return {
      success: true,
      output: {
        jobs: rows.map((row) => mapGreenhouseFields(row, JOBS_V2_OUTPUTS)),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    jobs: {
      type: 'array',
      description: 'jobs on this page',
      items: { type: 'object', properties: { ...JOBS_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
