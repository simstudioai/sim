import type {
  GreenhouseListJobHiringManagersV2Params,
  GreenhouseListJobHiringManagersV2Response,
} from '@/tools/greenhouse/types'
import { JOB_HIRING_MANAGERS_V2_OUTPUTS, PAGE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListJobHiringManagersV2Tool: ToolConfig<
  GreenhouseListJobHiringManagersV2Params,
  GreenhouseListJobHiringManagersV2Response
> = {
  id: 'greenhouse_list_job_hiring_managers_v2',
  name: 'Greenhouse List Job Hiring Managers',
  description:
    'Lists one page of job hiring managers with cursor pagination and documented filters.',
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
    user_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User IDs Comma-separated values (maximum 50).',
    },
    job_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job IDs Comma-separated values (maximum 50).',
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
      greenhouseListUrl('job_hiring_managers', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        user_ids: { type: 'csv', maxItems: 50, integerItems: true },
        job_ids: { type: 'csv', maxItems: 50, integerItems: true },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: ['created_at', 'id', 'job_id', 'updated_at', 'user_id'],
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
        job_hiring_managers: rows.map((row) =>
          mapGreenhouseFields(row, JOB_HIRING_MANAGERS_V2_OUTPUTS)
        ),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    job_hiring_managers: {
      type: 'array',
      description: 'job hiring managers on this page',
      items: { type: 'object', properties: { ...JOB_HIRING_MANAGERS_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
