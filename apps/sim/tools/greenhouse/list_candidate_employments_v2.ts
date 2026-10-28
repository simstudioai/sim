import type {
  GreenhouseListCandidateEmploymentsV2Params,
  GreenhouseListCandidateEmploymentsV2Response,
} from '@/tools/greenhouse/types'
import { CANDIDATE_EMPLOYMENTS_V2_OUTPUTS, PAGE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListCandidateEmploymentsV2Tool: ToolConfig<
  GreenhouseListCandidateEmploymentsV2Params,
  GreenhouseListCandidateEmploymentsV2Response
> = {
  id: 'greenhouse_list_candidate_employments_v2',
  name: 'Greenhouse List Candidate Employments',
  description:
    'Lists one page of candidate employments with cursor pagination and documented filters.',
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
    candidate_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Candidate IDs Comma-separated values (maximum 50).',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated response field names. Omit to return all documented fields. Comma-separated values (maximum 50).',
    },
    latest: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Latest',
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('candidate_employments', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        candidate_ids: { type: 'csv', maxItems: 50, integerItems: true },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: [
            'candidate_id',
            'company_name',
            'created_at',
            'end_date',
            'id',
            'latest',
            'start_date',
            'title',
            'updated_at',
          ],
        },
        latest: { type: 'boolean' },
      }),
    method: 'GET',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const rows = await readGreenhouseList(response)
    return {
      success: true,
      output: {
        candidate_employments: rows.map((row) =>
          mapGreenhouseFields(row, CANDIDATE_EMPLOYMENTS_V2_OUTPUTS)
        ),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    candidate_employments: {
      type: 'array',
      description: 'candidate employments on this page',
      items: { type: 'object', properties: { ...CANDIDATE_EMPLOYMENTS_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
