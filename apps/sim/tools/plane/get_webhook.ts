import { PLANEV2WEBHOOKSA201E9_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Webhooksa201e9Schema } from '@/tools/plane/schemas'
import type { PlaneGetWebhookParams, PlaneGetWebhookResponse } from '@/tools/plane/types'
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

export const planeGetWebhookTool: ToolConfig<PlaneGetWebhookParams, PlaneGetWebhookResponse> = {
  id: 'plane_get_webhook',
  name: 'Plane Get a webhook',
  description: 'Get a webhook in Plane. Requires API v2.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The webhook id.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields). Requestable here: `content_type`, `created_at`, `created_by_id`, `id`, `is_active`, `name`, `scopes`, `url`, `version`.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/webhooks/${safeUrlPathSegment(params.pk, 'pk')}/`,
        planeVersionedValues(params, { fields: { key: 'fields', type: 'string', required: false } })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) => planeObjectResponse(response, planeV2Webhooksa201e9Schema),
  outputs: { result: PLANEV2WEBHOOKSA201E9_OUTPUT },
}
