import { PLANEV2WEBHOOKSBFEBF2_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Webhooksbfebf2Schema } from '@/tools/plane/schemas'
import type { PlaneCreateWebhookParams, PlaneCreateWebhookResponse } from '@/tools/plane/types'
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

export const planeCreateWebhookTool: ToolConfig<
  PlaneCreateWebhookParams,
  PlaneCreateWebhookResponse
> = {
  id: 'plane_create_webhook',
  name: 'Plane Create a webhook',
  description: 'Create a webhook in Plane. Requires API v2.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    apiVersion: PLANE_VERSION_PARAM,
    bodyOverrides: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON overrides using the canonical input names for the selected API version. Preserves empty strings, null, and empty arrays; unsupported fields are rejected.',
    },
    workspace_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace slug from the Plane URL (for example, my-team).',
    },
    content_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        '- `application/json` - application/json - `application/x-www-form-urlencoded` - application/x-www-form-urlencoded One of `application/json`, `application/x-www-form-urlencoded`.',
    },
    is_active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the record is active.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name. Maximum 255 characters. Nullable.',
    },
    scopes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'The scopes.',
    },
    url: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Target URL.' },
    version: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Version string, for example `1.4.0`. Maximum 10 characters.',
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
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/webhooks/`,
        planeVersionedValues(params, { fields: { key: 'fields', type: 'string', required: false } })
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          content_type: { key: 'content_type', type: 'string', required: false },
          is_active: { key: 'is_active', type: 'boolean', required: false },
          name: { key: 'name', type: 'string', required: false },
          scopes: { key: 'scopes', type: 'array', required: false },
          url: { key: 'url', type: 'string', required: false },
          version: { key: 'version', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) => planeObjectResponse(response, planeV2Webhooksbfebf2Schema),
  outputs: { result: PLANEV2WEBHOOKSBFEBF2_OUTPUT },
}
