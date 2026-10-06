import { PLANEV2WEBHOOKLOGS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WebhookLogsSchema } from '@/tools/plane/schemas'
import type { PlaneGetWebhookLogParams, PlaneGetWebhookLogResponse } from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeGetWebhookLogTool: ToolConfig<
  PlaneGetWebhookLogParams,
  PlaneGetWebhookLogResponse
> = {
  id: 'plane_get_webhook_log',
  name: 'Plane Get a webhook log',
  description: 'Get a webhook log in Plane. Requires API v2.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    apiVersion: PLANE_VERSION_PARAM,
    workspace_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace slug from the Plane URL (for example, my-team).',
    },
    webhook_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "The webhook whose delivery log you're reading.",
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The webhook log id.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `duration_ms`, `error_message`, `event_type`, `id`, `request_body`, `request_headers`, `request_method`, `response_body`, `response_headers`, `response_status`, `retry_count`, `status_text`, `webhook_id`.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/webhook-logs/${safeUrlPathSegment(params.webhook_id, 'webhook_id')}/${safeUrlPathSegment(params.pk, 'pk')}/`,
        planeVersionedValues(params, { fields: { key: 'fields', type: 'string', required: false } })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) => planeObjectResponse(response, planeV2WebhookLogsSchema),
  outputs: { result: PLANEV2WEBHOOKLOGS_OUTPUT },
}
