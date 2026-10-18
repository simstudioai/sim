import type {
  GreenhouseListApplicationsV2Params,
  GreenhouseListApplicationsV2Response,
} from '@/tools/greenhouse/types'
import { APPLICATIONS_V2_OUTPUTS, PAGE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListApplicationsV2Tool: ToolConfig<
  GreenhouseListApplicationsV2Params,
  GreenhouseListApplicationsV2Response
> = {
  id: 'greenhouse_list_applications_v2',
  name: 'Greenhouse List Applications',
  description: 'Lists one page of applications with cursor pagination and documented filters.',
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
    job_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job IDs Comma-separated values (maximum 50).',
    },
    prospective_job_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prospective job IDs Comma-separated values (maximum 50).',
    },
    job_post_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job post IDs Comma-separated values (maximum 50).',
    },
    source_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Source IDs Comma-separated values (maximum 50).',
    },
    referrer_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Referrer IDs Comma-separated values (maximum 50).',
    },
    stage_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Stage IDs Comma-separated values (maximum 50).',
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
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status Allowed: rejected, hired, converted, active.',
    },
    stage_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Stage name',
    },
    custom_field_option_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom field option ID',
    },
    last_activity_at: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Last activity at filter as JSON with gte, lte, gt, lt keys and ISO 8601 values, for example {"gte":"2026-01-01T00:00:00Z"}.',
    },
    prospect: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by prospect status: true for prospect applications, false for candidate applications. Omit to include both.',
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('applications', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        candidate_ids: { type: 'csv', maxItems: 50, integerItems: true },
        job_ids: { type: 'csv', maxItems: 50, integerItems: true },
        prospective_job_ids: { type: 'csv', maxItems: 50, integerItems: true },
        job_post_ids: { type: 'csv', maxItems: 50, integerItems: true },
        source_ids: { type: 'csv', maxItems: 50, integerItems: true },
        referrer_ids: { type: 'csv', maxItems: 50, integerItems: true },
        stage_ids: { type: 'csv', maxItems: 50, integerItems: true },
        job_interview_stage_ids: { type: 'csv', maxItems: 50, integerItems: true },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: [
            'agency_note_id',
            'answers',
            'candidate_id',
            'coordinator_id',
            'created_at',
            'custom_fields',
            'id',
            'job_id',
            'job_interview_stage_id',
            'job_post_id',
            'last_activity_at',
            'location_address',
            'needs_decision',
            'prospect',
            'prospective_job_ids',
            'recruiter_id',
            'referrer_id',
            'rejected_at',
            'rejection_reason_id',
            'source_id',
            'stage_id',
            'stage_name',
            'status',
            'updated_at',
          ],
        },
        status: { type: 'string', enum: ['rejected', 'hired', 'converted', 'active'] },
        stage_name: { type: 'string' },
        custom_field_option_id: { type: 'integer' },
        last_activity_at: { type: 'object' },
        prospect: { type: 'boolean' },
      }),
    method: 'GET',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const rows = await readGreenhouseList(response)
    return {
      success: true,
      output: {
        applications: rows.map((row) => mapGreenhouseFields(row, APPLICATIONS_V2_OUTPUTS)),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    applications: {
      type: 'array',
      description: 'applications on this page',
      items: { type: 'object', properties: { ...APPLICATIONS_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
