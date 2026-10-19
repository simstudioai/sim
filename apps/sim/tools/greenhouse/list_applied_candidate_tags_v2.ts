import type {
  GreenhouseListAppliedCandidateTagsV2Params,
  GreenhouseListAppliedCandidateTagsV2Response,
} from '@/tools/greenhouse/types'
import { APPLIED_CANDIDATE_TAGS_V2_OUTPUTS, PAGE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListAppliedCandidateTagsV2Tool: ToolConfig<
  GreenhouseListAppliedCandidateTagsV2Params,
  GreenhouseListAppliedCandidateTagsV2Response
> = {
  id: 'greenhouse_list_applied_candidate_tags_v2',
  name: 'Greenhouse List Applied Candidate Tags',
  description:
    'Lists one page of applied candidate tags with cursor pagination and documented filters.',
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
    candidate_tag_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Candidate tag IDs Comma-separated values (maximum 50).',
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
  },
  request: {
    url: (params) =>
      greenhouseListUrl('applied_candidate_tags', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        candidate_tag_ids: { type: 'csv', maxItems: 50, integerItems: true },
        candidate_ids: { type: 'csv', maxItems: 50, integerItems: true },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: ['candidate_id', 'candidate_tag_id', 'created_at', 'id', 'updated_at'],
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
        applied_candidate_tags: rows.map((row) =>
          mapGreenhouseFields(row, APPLIED_CANDIDATE_TAGS_V2_OUTPUTS)
        ),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    applied_candidate_tags: {
      type: 'array',
      description: 'applied candidate tags on this page',
      items: { type: 'object', properties: { ...APPLIED_CANDIDATE_TAGS_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
