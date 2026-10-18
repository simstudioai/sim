import type {
  GreenhouseListCandidatesV2Params,
  GreenhouseListCandidatesV2Response,
} from '@/tools/greenhouse/types'
import { CANDIDATES_V2_OUTPUTS, PAGE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListCandidatesV2Tool: ToolConfig<
  GreenhouseListCandidatesV2Params,
  GreenhouseListCandidatesV2Response
> = {
  id: 'greenhouse_list_candidates_v2',
  name: 'Greenhouse List Candidates',
  description: 'Lists one page of candidates with cursor pagination and documented filters.',
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
    last_activity_at: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Last activity at filter as JSON with gte, lte, gt, lt keys and ISO 8601 values, for example {"gte":"2026-01-01T00:00:00Z"}.',
    },
    custom_field_option_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom field option ID',
    },
    private: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Candidate or custom-field privacy flag; for candidate listing, false excludes private candidates.',
    },
    email: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Email' },
    tag: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Tag' },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('candidates', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: [
            'addresses',
            'can_email',
            'company',
            'created_at',
            'custom_fields',
            'email_addresses',
            'first_name',
            'id',
            'last_activity_at',
            'last_name',
            'linked_user_ids',
            'phone_numbers',
            'preferred_name',
            'private',
            'social_media_addresses',
            'tags',
            'time_zone',
            'title',
            'updated_at',
            'website_addresses',
          ],
        },
        last_activity_at: { type: 'object' },
        custom_field_option_id: { type: 'integer' },
        private: { type: 'boolean' },
        email: { type: 'string' },
        tag: { type: 'string' },
      }),
    method: 'GET',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const rows = await readGreenhouseList(response)
    return {
      success: true,
      output: {
        candidates: rows.map((row) => mapGreenhouseFields(row, CANDIDATES_V2_OUTPUTS)),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    candidates: {
      type: 'array',
      description: 'candidates on this page',
      items: { type: 'object', properties: { ...CANDIDATES_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
