import { PLANEV2WORKSPACEVIEWS490E6D_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkspaceViews490e6dSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetWorkspaceViewParams,
  PlaneGetWorkspaceViewResponse,
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

export const planeGetWorkspaceViewTool: ToolConfig<
  PlaneGetWorkspaceViewParams,
  PlaneGetWorkspaceViewResponse
> = {
  id: 'plane_get_workspace_view',
  name: 'Plane Get a workspace view',
  description: 'Get a workspace view in Plane. Requires API v2.',
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
      description: 'The workspace view id.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `access`, `archived_at`, `created_at`, `created_by_id`, `description`, `display_filters`, `display_properties`, `filters`, `id`, `is_locked`, `logo_props`, `name`, `owned_by_id`, `pql_filters`, `query`, `sort_order`.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `owned_by`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/views/${safeUrlPathSegment(params.pk, 'pk')}/`,
        planeVersionedValues(params, {
          fields: { key: 'fields', type: 'string', required: false },
          expand: { key: 'expand', type: 'string', required: false },
        })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2WorkspaceViews490e6dSchema),
  outputs: { result: PLANEV2WORKSPACEVIEWS490E6D_OUTPUT },
}
