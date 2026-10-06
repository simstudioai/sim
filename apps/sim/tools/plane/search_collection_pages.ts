import {
  COLLECTIONPAGESEARCHRESULT_OUTPUT,
  PLANEV2COLLECTIONS992736_OUTPUT,
} from '@/tools/plane/outputs'
import {
  collectionPageSearchResultSchema,
  planeV2Collections992736Schema,
} from '@/tools/plane/schemas'
import type {
  PlaneSearchCollectionPagesParams,
  PlaneSearchCollectionPagesResponse,
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

export const planeSearchCollectionPagesTool: ToolConfig<
  PlaneSearchCollectionPagesParams,
  PlaneSearchCollectionPagesResponse
> = {
  id: 'plane_search_collection_pages',
  name: 'Plane Search pages for a collection',
  description: 'Search pages for a collection in Plane. Supports API v1 compatibility.',
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
      description: 'The collection page search id.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `id`, `logo_props`, `name`.",
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. A page-name search string.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1' ? ['workspace_slug', 'pk', 'search'] : ['workspace_slug', 'pk', 'fields'],
        ['workspace_slug', 'pk', 'fields', 'search'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/collections/${safeUrlPathSegment(params.pk, 'pk')}/pages-search/`,
            planeVersionedValues(params, {
              search: { key: 'search', type: 'string', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/collections/${safeUrlPathSegment(params.pk, 'pk')}/pages-search/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
            })
          )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeListResponse(response, collectionPageSearchResultSchema, false, false)
      : planeObjectResponse(response, planeV2Collections992736Schema),
  outputs: {
    result: PLANEV2COLLECTIONS992736_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: COLLECTIONPAGESEARCHRESULT_OUTPUT.type,
        description: COLLECTIONPAGESEARCHRESULT_OUTPUT.description,
        properties: COLLECTIONPAGESEARCHRESULT_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
