import type {
  GreenhouseConvertProspectV2Params,
  GreenhouseConvertProspectV2Response,
} from '@/tools/greenhouse/types'
import { APPLICATIONS_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseBody,
  greenhouseHeaders,
  mapGreenhouseFields,
  readGreenhouseRecord,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const greenhouseConvertProspectV2Tool: ToolConfig<
  GreenhouseConvertProspectV2Params,
  GreenhouseConvertProspectV2Response
> = {
  id: 'greenhouse_convert_prospect_v2',
  name: 'Greenhouse Convert Prospect',
  description:
    'Converts a prospect application into a new candidate application on a job already associated with the prospect.',
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
    job_id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Job ID already associated with the prospect or its pool.',
    },
    to_job_interview_stage_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Target job interview stage ID; omit to use the job’s first stage.',
    },
  },
  request: {
    url: (params) =>
      `https://harvest.greenhouse.io/v3/applications/${safeUrlPathSegment(params.id, 'id')}/convert_to_candidate`,
    method: 'POST',
    headers: (params) => greenhouseHeaders(params.accessToken),
    body: (params) =>
      greenhouseBody(
        params,
        {
          job_id: { type: 'integer', required: true },
          to_job_interview_stage_id: { type: 'integer' },
        },
        'convert_prospect'
      ),
  },
  transformResponse: async (response) => ({
    success: true,
    output: mapGreenhouseFields(await readGreenhouseRecord(response), APPLICATIONS_V2_OUTPUTS),
  }),
  outputs: { ...APPLICATIONS_V2_OUTPUTS },
}
