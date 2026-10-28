import type {
  GreenhouseListInterviewsV2Params,
  GreenhouseListInterviewsV2Response,
} from '@/tools/greenhouse/types'
import { INTERVIEWS_V2_OUTPUTS, PAGE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListInterviewsV2Tool: ToolConfig<
  GreenhouseListInterviewsV2Params,
  GreenhouseListInterviewsV2Response
> = {
  id: 'greenhouse_list_interviews_v2',
  name: 'Greenhouse List Interviews',
  description: 'Lists one page of interviews with cursor pagination and documented filters.',
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
    job_interview_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job interview IDs Comma-separated values (maximum 50).',
    },
    organizer_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organizer IDs Comma-separated values (maximum 50).',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated response field names. Omit to return all documented fields. Comma-separated values (maximum 50).',
    },
    starts_at: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Starts at filter as JSON with gte, lte, gt, lt keys and ISO 8601 values, for example {"gte":"2026-01-01T00:00:00Z"}.',
    },
    ends_at: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Ends at filter as JSON with gte, lte, gt, lt keys and ISO 8601 values, for example {"gte":"2026-01-01T00:00:00Z"}.',
    },
    all_day_start_on: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'All day start on filter as JSON with gte, lte, gt, lt keys and YYYY-MM-DD dates, for example {"gte":"2026-01-01"}.',
    },
    all_day_end_on: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'All day end on filter as JSON with gte, lte, gt, lt keys and YYYY-MM-DD dates, for example {"gte":"2026-01-01"}.',
    },
    external_event_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External event ID',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Status Allowed: to_be_scheduled, scheduled, awaiting_feedback, complete, skipped, collect_feedback, to_be_sent, sent, received.',
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('interviews', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        job_ids: { type: 'csv', maxItems: 50, integerItems: true },
        application_ids: { type: 'csv', maxItems: 50, integerItems: true },
        job_interview_ids: { type: 'csv', maxItems: 50, integerItems: true },
        organizer_ids: { type: 'csv', maxItems: 50, integerItems: true },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: [
            'all_day_end_on',
            'all_day_start_on',
            'application_id',
            'availability_received_at',
            'created_at',
            'ends_at',
            'external_event_id',
            'id',
            'job_id',
            'job_interview_id',
            'location',
            'organizer_id',
            'scheduled_at',
            'starts_at',
            'status',
            'updated_at',
            'video_conferencing_url',
          ],
        },
        starts_at: { type: 'object' },
        ends_at: { type: 'object' },
        all_day_start_on: { type: 'object' },
        all_day_end_on: { type: 'object' },
        external_event_id: { type: 'string' },
        status: {
          type: 'string',
          enum: [
            'to_be_scheduled',
            'scheduled',
            'awaiting_feedback',
            'complete',
            'skipped',
            'collect_feedback',
            'to_be_sent',
            'sent',
            'received',
          ],
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
        interviews: rows.map((row) => mapGreenhouseFields(row, INTERVIEWS_V2_OUTPUTS)),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    interviews: {
      type: 'array',
      description: 'interviews on this page',
      items: { type: 'object', properties: { ...INTERVIEWS_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
