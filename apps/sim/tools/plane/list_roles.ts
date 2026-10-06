import { PLANEV2V2LISTROLESRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ListRolesresultSchema } from '@/tools/plane/schemas'
import type { PlaneListRolesParams, PlaneListRolesResponse } from '@/tools/plane/types'
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

export const planeListRolesTool: ToolConfig<PlaneListRolesParams, PlaneListRolesResponse> = {
  id: 'plane_list_roles',
  name: 'Plane List roles',
  description: 'List roles in Plane. Requires API v2.',
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
    is_system: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `is_system`.',
    },
    namespace: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether this role is for instance, workspace, or project-level resources - `instance` - Instance - `workspace` - Workspace - `project` - Project One of `instance`, `project`, `workspace`.',
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
    new_slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `slug`.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `description`, `id`, `is_system`, `level`, `name`, `namespace`, `slug`, `status`.",
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
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/roles/`,
        planeVersionedValues(params, {
          count: { key: 'count', type: 'boolean', required: false },
          is_system: { key: 'is_system', type: 'boolean', required: false },
          namespace: { key: 'namespace', type: 'string', required: false },
          offset: { key: 'offset', type: 'integer', required: false },
          order_by: { key: 'order_by', type: 'string', required: false },
          paginate: { key: 'paginate', type: 'string', required: false },
          per_page: { key: 'per_page', type: 'integer', required: false },
          search: { key: 'search', type: 'string', required: false },
          slug: { key: 'new_slug', type: 'string', required: false },
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
    planeObjectResponse(response, planeV2V2ListRolesresultSchema),
  outputs: { result: PLANEV2V2LISTROLESRESULT_OUTPUT },
}
