import { COLLECTIONBRANCHPAGEEDA77C_OUTPUT } from '@/tools/plane/outputs'
import { collectionBranchPageeda77cSchema } from '@/tools/plane/schemas'
import type {
  PlaneListCollectionPagesParams,
  PlaneListCollectionPagesResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  PLANE_PAGINATION_OUTPUT,
  planeApiUrl,
  planeHeaders,
  planeListResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeListCollectionPagesTool: ToolConfig<
  PlaneListCollectionPagesParams,
  PlaneListCollectionPagesResponse
> = {
  id: 'plane_list_collection_pages',
  name: 'Plane v1 only: List collection pages',
  description: 'v1 only: List collection pages in Plane. Requires API v1.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    workspace_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace slug from the Plane URL (for example, my-team).',
    },
    collection_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The collection ID.',
    },
    parent_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return direct children of this page.',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Case-insensitive page-name search.',
    },
    created_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated creator IDs.',
    },
    favorites: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: "Filter by the current user's favorite status.",
    },
    labels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated label IDs.',
    },
    created_at__gte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Created on or after this date.',
    },
    created_at__lte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Created on or before this date.',
    },
    owned_by_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by owner.',
    },
    owned_by_id__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated owner IDs.',
    },
    parent_id__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated parent IDs.',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page. Defaults to 50; maximum 100.',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor returned by a previous page.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of related fields to expand in response',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of fields to include in response',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External system identifier for filtering or lookup',
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External system source name for filtering or lookup',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Field to order results by. Prefix with '-' for descending order",
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/collections/${safeUrlPathSegment(params.collection_id, 'collection_id')}/pages/`,
        planeVersionedValues(params, {
          parent_id: { key: 'parent_id', type: 'string', required: false },
          search: { key: 'search', type: 'string', required: false },
          created_by: { key: 'created_by', type: 'string', required: false },
          favorites: { key: 'favorites', type: 'boolean', required: false },
          labels: { key: 'labels', type: 'string', required: false },
          created_at__gte: { key: 'created_at__gte', type: 'string', required: false },
          created_at__lte: { key: 'created_at__lte', type: 'string', required: false },
          owned_by_id: { key: 'owned_by_id', type: 'string', required: false },
          owned_by_id__in: { key: 'owned_by_id__in', type: 'string', required: false },
          parent_id__in: { key: 'parent_id__in', type: 'string', required: false },
          per_page: { key: 'per_page', type: 'integer', required: false },
          cursor: { key: 'cursor', type: 'string', required: false },
          expand: { key: 'expand', type: 'string', required: false },
          fields: { key: 'fields', type: 'string', required: false },
          external_id: { key: 'external_id', type: 'string', required: false },
          external_source: { key: 'external_source', type: 'string', required: false },
          order_by: { key: 'order_by', type: 'string', required: false },
        })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeListResponse(response, collectionBranchPageeda77cSchema, true, false),
  outputs: {
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: COLLECTIONBRANCHPAGEEDA77C_OUTPUT.type,
        description: COLLECTIONBRANCHPAGEEDA77C_OUTPUT.description,
        properties: COLLECTIONBRANCHPAGEEDA77C_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
    pagination: PLANE_PAGINATION_OUTPUT,
  },
}
