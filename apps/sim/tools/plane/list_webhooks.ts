import { PLANEV2V2LISTWEBHOOKSRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ListWebhooksresultSchema } from '@/tools/plane/schemas'
import type { PlaneListWebhooksParams, PlaneListWebhooksResponse } from '@/tools/plane/types'
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

export const planeListWebhooksTool: ToolConfig<PlaneListWebhooksParams, PlaneListWebhooksResponse> =
  {
    id: 'plane_list_webhooks',
    name: 'Plane List webhooks',
    description: 'List webhooks in Plane. Requires API v2.',
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
      count: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Set to false to skip the total_count COUNT(\\*) (omits total_count).',
      },
      is_active: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `is_active`.',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `name`.',
      },
      offset: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of rows to skip from the start of the result set.',
      },
      order_by: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          "Field to order the list by. Prefix with '-' for descending (e.g. '-created_at'). Annotation-backed orders sort semantically and ride the default offset page.",
      },
      paginate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          "Set to 'cursor' to opt into the COUNT-free keyset cursor envelope (use for deep traversal); omit for the default offset envelope with total_count. One of `cursor`.",
      },
      per_page: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Page size (max 200).',
      },
      search: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'A search term.',
      },
      url: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `url`.',
      },
      fields: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields). Requestable here: `content_type`, `created_at`, `created_by_id`, `id`, `is_active`, `name`, `scopes`, `url`, `version`.",
      },
      cursor: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Cursor from next_cursor. Repeat the original filters, per_page, and order_by when following it.',
      },
    },
    request: {
      url: (params) => {
        planeApiVersion(params.apiVersion, false)
        return planeApiUrl(
          params.baseUrl,
          `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/webhooks/`,
          planeVersionedValues(params, {
            count: { key: 'count', type: 'boolean', required: false },
            is_active: { key: 'is_active', type: 'boolean', required: false },
            name: { key: 'name', type: 'string', required: false },
            offset: { key: 'offset', type: 'integer', required: false },
            order_by: { key: 'order_by', type: 'string', required: false },
            paginate: { key: 'paginate', type: 'string', required: false },
            per_page: { key: 'per_page', type: 'integer', required: false },
            search: { key: 'search', type: 'string', required: false },
            url: { key: 'url', type: 'string', required: false },
            fields: { key: 'fields', type: 'string', required: false },
            cursor: { key: 'cursor', type: 'string', required: false },
          })
        )
      },
      method: 'GET',
      headers: (params) => planeHeaders(params.apiKey),
      redirectPolicy: planeRedirectPolicy,
      retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
    },
    transformResponse: async (response) =>
      planeObjectResponse(response, planeV2V2ListWebhooksresultSchema),
    outputs: { result: PLANEV2V2LISTWEBHOOKSRESULT_OUTPUT },
  }
