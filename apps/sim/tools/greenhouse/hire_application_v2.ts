import type {
  GreenhouseHireApplicationV2Params,
  GreenhouseHireApplicationV2Response,
} from '@/tools/greenhouse/types'
import { greenhouseBody, greenhouseHeaders, readGreenhouseEmpty } from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const greenhouseHireApplicationV2Tool: ToolConfig<
  GreenhouseHireApplicationV2Params,
  GreenhouseHireApplicationV2Response
> = {
  id: 'greenhouse_hire_application_v2',
  name: 'Greenhouse Hire Application',
  description:
    'Marks an application hired and closes its opening; provide opening_id when the job has multiple open openings.',
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
    start_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date (ISO 8601)',
    },
    opening_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opening ID; required when hiring into a job with multiple open openings.',
    },
    close_reason_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Close reason ID',
    },
  },
  request: {
    url: (params) =>
      `https://harvest.greenhouse.io/v3/applications/${safeUrlPathSegment(params.id, 'id')}/hire`,
    method: 'POST',
    headers: (params) => greenhouseHeaders(params.accessToken),
    body: (params) =>
      greenhouseBody(
        params,
        {
          start_date: { type: 'string' },
          opening_id: { type: 'integer' },
          close_reason_id: { type: 'integer' },
        },
        'hire_application'
      ),
  },
  transformResponse: async (response) => {
    await readGreenhouseEmpty(response)
    return { success: true, output: {} }
  },
  outputs: {},
}
