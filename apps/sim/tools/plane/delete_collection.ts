import type {
  PlaneDeleteCollectionParams,
  PlaneDeleteCollectionResponse,
} from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeDeleteCollectionTool: ToolConfig<
  PlaneDeleteCollectionParams,
  PlaneDeleteCollectionResponse
> = {
  id: 'plane_delete_collection',
  name: 'Plane Delete a collection',
  description: 'Delete a collection in Plane. Supports API v1 compatibility.',
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
      description: 'The collection id.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `access`, `created_at`, `created_by_id`, `id`, `is_default`, `is_global`, `logo_props`, `name`, `owned_by_id`, `page_ids`, `sort_order`.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `owned_by`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
    },
    archive_pages: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Whether to archive contained pages. Defaults to `true`.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'pk', 'archive_pages']
          : ['workspace_slug', 'pk', 'fields', 'expand'],
        ['workspace_slug', 'pk', 'fields', 'expand', 'archive_pages'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/collections/${safeUrlPathSegment(params.pk, 'pk')}/`,
            planeVersionedValues(params, {
              archive_pages: { key: 'archive_pages', type: 'boolean', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/collections/${safeUrlPathSegment(params.pk, 'pk')}/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
            })
          )
    },
    method: 'DELETE',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
  },
  transformResponse: async (_response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? { success: true, output: { success: true } }
      : { success: true, output: { success: true } },
  outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
}
