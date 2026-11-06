import type {
  GreenhouseListScorecardsV2Params,
  GreenhouseListScorecardsV2Response,
} from '@/tools/greenhouse/types'
import { PAGE_V2_OUTPUTS, SCORECARDS_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListScorecardsV2Tool: ToolConfig<
  GreenhouseListScorecardsV2Params,
  GreenhouseListScorecardsV2Response
> = {
  id: 'greenhouse_list_scorecards_v2',
  name: 'Greenhouse List Scorecards',
  description: 'Lists one page of scorecards with cursor pagination and documented filters.',
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
    interview_kit_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Interview kit IDs Comma-separated values (maximum 50).',
    },
    submitter_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Submitter IDs Comma-separated values (maximum 50).',
    },
    application_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Application IDs Comma-separated values (maximum 50).',
    },
    interviewer_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Interviewer IDs Comma-separated values (maximum 50).',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated response field names. Omit to return all documented fields. Comma-separated values (maximum 50).',
    },
    interviewed_at: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Interviewed at filter as JSON with gte, lte, gt, lt keys and ISO 8601 values, for example {"gte":"2026-01-01T00:00:00Z"}.',
    },
    submitted_at: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Submitted at filter as JSON with gte, lte, gt, lt keys and ISO 8601 values, for example {"gte":"2026-01-01T00:00:00Z"}.',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status Allowed: draft, complete.',
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('scorecards', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        interview_kit_ids: { type: 'csv', maxItems: 50, integerItems: true },
        submitter_ids: { type: 'csv', maxItems: 50, integerItems: true },
        application_ids: { type: 'csv', maxItems: 50, integerItems: true },
        interviewer_ids: { type: 'csv', maxItems: 50, integerItems: true },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: [
            'application_id',
            'candidate_rating',
            'created_at',
            'id',
            'interview_kit_id',
            'interviewed_at',
            'interviewer_id',
            'notes',
            'notes_with_tags',
            'private_notes',
            'private_notes_with_tags',
            'public_notes',
            'public_notes_with_tags',
            'status',
            'submitted_at',
            'submitter_id',
            'updated_at',
          ],
        },
        interviewed_at: { type: 'object' },
        submitted_at: { type: 'object' },
        status: { type: 'string', enum: ['draft', 'complete'] },
      }),
    method: 'GET',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const rows = await readGreenhouseList(response)
    return {
      success: true,
      output: {
        scorecards: rows.map((row) => mapGreenhouseFields(row, SCORECARDS_V2_OUTPUTS)),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    scorecards: {
      type: 'array',
      description: 'scorecards on this page',
      items: { type: 'object', properties: { ...SCORECARDS_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
