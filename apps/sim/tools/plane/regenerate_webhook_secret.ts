import { PLANEV2V2REGENERATEWEBHOOKSECRETRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2RegenerateWebhookSecretresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneRegenerateWebhookSecretParams,
  PlaneRegenerateWebhookSecretResponse,
} from '@/tools/plane/types'
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

export const planeRegenerateWebhookSecretTool: ToolConfig<
  PlaneRegenerateWebhookSecretParams,
  PlaneRegenerateWebhookSecretResponse
> = {
  id: 'plane_regenerate_webhook_secret',
  name: 'Plane Regenerate a webhook secret',
  description: 'Regenerate a webhook secret in Plane. Requires API v2.',
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
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `content_type`, `created_at`, `created_by_id`, `id`, `is_active`, `name`, `scopes`, `secret_key`, `url`, `version`.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/webhooks/${safeUrlPathSegment(params.pk, 'pk')}/regenerate/`,
        planeVersionedValues(params, { fields: { key: 'fields', type: 'string', required: false } })
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2RegenerateWebhookSecretresultSchema),
  outputs: { result: PLANEV2V2REGENERATEWEBHOOKSECRETRESULT_OUTPUT },
}
