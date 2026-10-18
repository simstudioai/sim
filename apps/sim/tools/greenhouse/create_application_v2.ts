import type {
  GreenhouseCreateApplicationV2Params,
  GreenhouseCreateApplicationV2Response,
} from '@/tools/greenhouse/types'
import { GREENHOUSE_APPLICATION_CUSTOM_FIELD_INPUT } from '@/tools/greenhouse/v2_inputs'
import { APPLICATIONS_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  GREENHOUSE_APPLICATION_FIELDS,
  greenhouseBody,
  greenhouseHeaders,
  mapGreenhouseFields,
  readGreenhouseRecord,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseCreateApplicationV2Tool: ToolConfig<
  GreenhouseCreateApplicationV2Params,
  GreenhouseCreateApplicationV2Response
> = {
  id: 'greenhouse_create_application_v2',
  name: 'Greenhouse Create Application',
  description: 'Creates a job application or prospect application for an existing candidate.',
  version: '2.0.0',
  oauth: { required: true, provider: 'greenhouse' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Greenhouse OAuth access token',
    },
    source_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Source ID',
    },
    recruiter_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Recruiter ID',
    },
    coordinator_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Coordinator ID',
    },
    referrer_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Referrer ID',
    },
    created_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Creation time in ISO 8601 format',
    },
    custom_fields: {
      type: 'array',
      items: GREENHOUSE_APPLICATION_CUSTOM_FIELD_INPUT,
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of {name_key or custom_field_id, value}; use exactly one identifier per entry. Values follow the field type; null clears a value. JSON array of objects with name_key, custom_field_id, value.',
    },
    candidate_id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Candidate ID to create the application for.',
    },
    job_id: { type: 'number', required: false, visibility: 'user-or-llm', description: 'Job ID' },
    initial_stage_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Initial stage ID',
    },
    prospect: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether this is a prospect application. Set true to use prospect placement fields instead of job_id.',
    },
    job_ids: {
      type: 'array',
      items: { type: 'integer' },
      required: false,
      visibility: 'user-or-llm',
      description: 'Job IDs for a prospect as a JSON array of integers. Requires prospect=true.',
    },
    prospect_pool_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prospect pool ID',
    },
    prospect_pool_stage_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prospect pool stage ID',
    },
    prospect_owner_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prospect owner ID',
    },
    prospective_department_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prospective department ID',
    },
    prospective_office_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prospective office ID',
    },
  },
  request: {
    url: 'https://harvest.greenhouse.io/v3/applications',
    method: 'POST',
    headers: (params) => greenhouseHeaders(params.accessToken),
    body: (params) =>
      greenhouseBody(
        params,
        {
          ...GREENHOUSE_APPLICATION_FIELDS,
          candidate_id: { type: 'integer', required: true },
        },
        'create_application'
      ),
  },
  transformResponse: async (response) => ({
    success: true,
    output: mapGreenhouseFields(await readGreenhouseRecord(response), APPLICATIONS_V2_OUTPUTS),
  }),
  outputs: { ...APPLICATIONS_V2_OUTPUTS },
}
