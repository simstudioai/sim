import type {
  GreenhouseListApplicationStagesV2Params,
  GreenhouseListApplicationStagesV2Response,
} from '@/tools/greenhouse/types'
import { APPLICATION_STAGES_V2_OUTPUTS, PAGE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListApplicationStagesV2Tool: ToolConfig<
  GreenhouseListApplicationStagesV2Params,
  GreenhouseListApplicationStagesV2Response
> = {
  id: 'greenhouse_list_application_stages_v2',
  name: 'Greenhouse List Application Stages',
  description:
    'Lists one page of application stages with cursor pagination and documented filters.',
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
    application_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Application IDs Comma-separated values (maximum 50).',
    },
    job_interview_stage_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job interview stage IDs Comma-separated values (maximum 50).',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated response field names. Omit to return all documented fields. Comma-separated values (maximum 50).',
    },
    current: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Current',
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('application_stages', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        application_ids: { type: 'csv', maxItems: 50, integerItems: true },
        job_interview_stage_ids: { type: 'csv', maxItems: 50, integerItems: true },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: [
            'application_id',
            'created_at',
            'current',
            'days_in_stage',
            'entered_at',
            'exited_at',
            'id',
            'job_interview_stage_id',
            'updated_at',
          ],
        },
        current: { type: 'boolean' },
      }),
    method: 'GET',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const rows = await readGreenhouseList(response)
    return {
      success: true,
      output: {
        application_stages: rows.map((row) =>
          mapGreenhouseFields(row, APPLICATION_STAGES_V2_OUTPUTS)
        ),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    application_stages: {
      type: 'array',
      description: 'application stages on this page',
      items: { type: 'object', properties: { ...APPLICATION_STAGES_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
