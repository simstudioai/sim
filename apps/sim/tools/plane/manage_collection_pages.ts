import {
  COLLECTIONPAGED68582_OUTPUT,
  PLANEV2V2MANAGECOLLECTIONPAGESRESULT_OUTPUT,
} from '@/tools/plane/outputs'
import {
  collectionPaged68582Schema,
  planeV2V2ManageCollectionPagesresultSchema,
} from '@/tools/plane/schemas'
import type {
  PlaneManageCollectionPagesParams,
  PlaneManageCollectionPagesResponse,
} from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeListResponse,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeManageCollectionPagesTool: ToolConfig<
  PlaneManageCollectionPagesParams,
  PlaneManageCollectionPagesResponse
> = {
  id: 'plane_manage_collection_pages',
  name: 'Plane Add or remove pages in a collection',
  description: 'Add or remove pages in a collection in Plane. Supports API v1 compatibility.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The collection page id.',
    },
    add: { type: 'json', required: false, visibility: 'user-or-llm', description: 'The add.' },
    remove: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'The remove.',
    },
    page_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. One or more workspace page IDs.',
    },
    sort_orders: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. Page-ID keys mapped to numeric sort orders. Every key must occur in `page_ids`.',
    },
    placement: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. Placement with `type`: `append`, `before`, or `after`; optional `parent_id`; and required `target_page_id` for `before` or `after`. Before/after accepts exactly one page.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'pk', 'page_ids', 'sort_orders', 'placement']
          : ['workspace_slug', 'pk', 'add', 'remove'],
        ['workspace_slug', 'pk', 'add', 'remove', 'page_ids', 'sort_orders', 'placement'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/collections/${safeUrlPathSegment(params.pk, 'pk')}/pages/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/collections/${safeUrlPathSegment(params.pk, 'pk')}/pages/`
          )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            {
              page_ids: { key: 'page_ids', type: 'array', required: true },
              sort_orders: { key: 'sort_orders', type: 'object', required: false },
              placement: { key: 'placement', type: 'object', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              add: { key: 'add', type: 'array', required: false },
              remove: { key: 'remove', type: 'array', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeListResponse(response, collectionPaged68582Schema, false, false)
      : planeObjectResponse(response, planeV2V2ManageCollectionPagesresultSchema),
  outputs: {
    result: PLANEV2V2MANAGECOLLECTIONPAGESRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: COLLECTIONPAGED68582_OUTPUT.type,
        description: COLLECTIONPAGED68582_OUTPUT.description,
        properties: COLLECTIONPAGED68582_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
