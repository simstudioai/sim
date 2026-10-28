import type {
  GreenhouseUpdateApplicationV2Params,
  GreenhouseUpdateApplicationV2Response,
} from '@/tools/greenhouse/types'
import { GREENHOUSE_APPLICATION_CUSTOM_FIELD_INPUT } from '@/tools/greenhouse/v2_inputs'
import { APPLICATIONS_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseBody,
  greenhouseHeaders,
  mapGreenhouseFields,
  readGreenhouseRecord,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const greenhouseUpdateApplicationV2Tool: ToolConfig<
  GreenhouseUpdateApplicationV2Params,
  GreenhouseUpdateApplicationV2Response
> = {
  id: 'greenhouse_update_application_v2',
  name: 'Greenhouse Update Application',
  description: 'Update application using Greenhouse Harvest v3.',
  version: '2.0.0',
  oauth: { required: true, provider: 'greenhouse' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Greenhouse OAuth access token',
    },
    id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Greenhouse resource ID',
    },
    source_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Source ID',
    },
    referrer_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Referrer ID',
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
    prospect_pool_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prospect pool ID',
    },
    prospect_stage_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prospect stage ID',
    },
    rejected_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rejected at (YYYY-MM-DD)',
    },
    created_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Application creation date in YYYY-MM-DD format.',
    },
    custom_fields: {
      type: 'array',
      items: GREENHOUSE_APPLICATION_CUSTOM_FIELD_INPUT,
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of {name_key or custom_field_id, value}; use exactly one identifier per entry. Values follow the field type; null clears a value. JSON array of objects with name_key, custom_field_id, value.',
    },
  },
  request: {
    url: (params) =>
      `https://harvest.greenhouse.io/v3/applications/${safeUrlPathSegment(params.id, 'id')}`,
    method: 'PATCH',
    headers: (params) => greenhouseHeaders(params.accessToken),
    body: (params) =>
      greenhouseBody(
        params,
        {
          source_id: { type: 'integer' },
          referrer_id: { type: 'integer' },
          recruiter_id: { type: 'integer' },
          coordinator_id: { type: 'integer' },
          prospect_pool_id: { type: 'number' },
          prospect_stage_id: { type: 'number' },
          rejected_at: { type: 'string' },
          created_at: { type: 'string' },
          custom_fields: { type: 'array' },
        },
        'update_application'
      ),
  },
  transformResponse: async (response) => ({
    success: true,
    output: mapGreenhouseFields(await readGreenhouseRecord(response), APPLICATIONS_V2_OUTPUTS),
  }),
  outputs: { ...APPLICATIONS_V2_OUTPUTS },
}
