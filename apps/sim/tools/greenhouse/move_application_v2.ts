import type {
  GreenhouseMoveApplicationV2Params,
  GreenhouseMoveApplicationV2Response,
} from '@/tools/greenhouse/types'
import { greenhouseBody, greenhouseHeaders, readGreenhouseEmpty } from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const greenhouseMoveApplicationV2Tool: ToolConfig<
  GreenhouseMoveApplicationV2Params,
  GreenhouseMoveApplicationV2Response
> = {
  id: 'greenhouse_move_application_v2',
  name: 'Greenhouse Move Application',
  description:
    'Moves or advances an application using its current stage as a guard; configured stage rules may send emails.',
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
    from_stage_id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Current application stage ID, required to guard against a stale move. Use stage_id from the application.',
    },
    to_stage_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Target stage ID for a move within the current job. Use to_job_id when transferring to another job.',
    },
    to_job_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Destination job ID when transferring the application to another job.',
    },
    email_from_user_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID to send any automated stage-transition emails from.',
    },
  },
  request: {
    url: (params) =>
      `https://harvest.greenhouse.io/v3/applications/${safeUrlPathSegment(params.id, 'id')}/move`,
    method: 'POST',
    headers: (params) => greenhouseHeaders(params.accessToken),
    body: (params) =>
      greenhouseBody(
        params,
        {
          from_stage_id: { type: 'integer', required: true },
          to_stage_id: { type: 'integer' },
          to_job_id: { type: 'integer' },
          email_from_user_id: { type: 'integer' },
        },
        'move_application'
      ),
  },
  transformResponse: async (response) => {
    await readGreenhouseEmpty(response)
    return { success: true, output: {} }
  },
  outputs: {},
}
