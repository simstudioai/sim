import type {
  GreenhouseListNotesV2Params,
  GreenhouseListNotesV2Response,
} from '@/tools/greenhouse/types'
import { NOTES_V2_OUTPUTS, PAGE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListNotesV2Tool: ToolConfig<
  GreenhouseListNotesV2Params,
  GreenhouseListNotesV2Response
> = {
  id: 'greenhouse_list_notes_v2',
  name: 'Greenhouse List Notes',
  description: 'Lists one page of notes with cursor pagination and documented filters.',
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
    user_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User IDs Comma-separated values (maximum 50).',
    },
    application_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Application IDs Comma-separated values (maximum 50).',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated response field names. Omit to return all documented fields. Comma-separated values (maximum 50).',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Type Comma-separated values (maximum 50).',
    },
    visibility: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Visibility Allowed: admin_only_visible, privately_visible, publicly_visible.',
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('notes', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        candidate_ids: { type: 'csv', maxItems: 50, integerItems: true },
        user_ids: { type: 'csv', maxItems: 50, integerItems: true },
        application_ids: { type: 'csv', maxItems: 50, integerItems: true },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: [
            'application_id',
            'body',
            'body_with_tags',
            'candidate_id',
            'created_at',
            'email_attachment_file_names',
            'email_cc',
            'email_from',
            'email_to',
            'id',
            'import_hash',
            'subject',
            'type',
            'updated_at',
            'user_id',
            'visibility',
          ],
        },
        type: {
          type: 'csv',
          maxItems: 13,
          enumItems: [
            'NOTE',
            'ACTIVITY',
            'INTERVIEW',
            'EMAIL',
            'FOLLOW_UP',
            'TAKE_HOME_TEST',
            'LINKEDIN_NOTE',
            'LINKEDIN_INMAIL',
            'AVAILABILITY_REQUEST',
            'MIGRATION_ERROR',
            'TOUCHPOINT',
            'FORM',
            'FEEDBACK',
          ],
        },
        visibility: {
          type: 'string',
          enum: ['admin_only_visible', 'privately_visible', 'publicly_visible'],
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
        notes: rows.map((row) => mapGreenhouseFields(row, NOTES_V2_OUTPUTS)),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    notes: {
      type: 'array',
      description: 'notes on this page',
      items: { type: 'object', properties: { ...NOTES_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
