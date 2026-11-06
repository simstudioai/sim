import type {
  GreenhouseRejectApplicationV2Params,
  GreenhouseRejectApplicationV2Response,
} from '@/tools/greenhouse/types'
import { GREENHOUSE_CUSTOM_FIELD_INPUT } from '@/tools/greenhouse/v2_inputs'
import { greenhouseBody, greenhouseHeaders, readGreenhouseEmpty } from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const greenhouseRejectApplicationV2Tool: ToolConfig<
  GreenhouseRejectApplicationV2Params,
  GreenhouseRejectApplicationV2Response
> = {
  id: 'greenhouse_reject_application_v2',
  name: 'Greenhouse Reject Application',
  description:
    'Rejects an application; optionally sends or schedules the configured rejection email.',
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
    rejection_reason_id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Rejection reason ID',
    },
    notes: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Notes' },
    rejection_email: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional JSON object {send_email_at, email_template_id, email_from_user_id}; supplying it sends or schedules a rejection email.',
    },
    custom_fields: {
      type: 'array',
      items: GREENHOUSE_CUSTOM_FIELD_INPUT,
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of {name_key or custom_field_id, value}; use exactly one identifier per entry. Values follow the field type; null clears a value. JSON array of objects with name_key, custom_field_id, value.',
    },
  },
  request: {
    url: (params) =>
      `https://harvest.greenhouse.io/v3/applications/${safeUrlPathSegment(params.id, 'id')}/reject`,
    method: 'POST',
    headers: (params) => greenhouseHeaders(params.accessToken),
    body: (params) =>
      greenhouseBody(
        params,
        {
          rejection_reason_id: { type: 'integer', required: true },
          notes: { type: 'string' },
          rejection_email: { type: 'object' },
          custom_fields: { type: 'array' },
        },
        'reject_application'
      ),
  },
  transformResponse: async (response) => {
    await readGreenhouseEmpty(response)
    return { success: true, output: {} }
  },
  outputs: {},
}
