import {
  PLANEPAGECONTENT_OUTPUT,
  PLANEV2V2LISTPROJECTPAGESRESULT_OUTPUT,
} from '@/tools/plane/outputs'
import {
  planePageContentSchema,
  planeV2V2ListProjectPagesresultSchema,
} from '@/tools/plane/schemas'
import type {
  PlaneListProjectPagesParams,
  PlaneListProjectPagesResponse,
} from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_PAGINATION_OUTPUT,
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

export const planeListProjectPagesTool: ToolConfig<
  PlaneListProjectPagesParams,
  PlaneListProjectPagesResponse
> = {
  id: 'plane_list_project_pages',
  name: 'Plane List project pages',
  description: 'List project pages in Plane. Supports API v1 compatibility.',
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
    project_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The project the resource belongs to. Accepts the project UUID or its bare identifier, for example `ENG`.',
    },
    access: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: '- `0` - Public - `1` - Private One of `0`, `1`.',
    },
    collection_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `collection_id`.',
    },
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to false to skip the total_count COUNT(\\*) (omits total_count).',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `external_id`.',
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `external_source`.',
    },
    is_global: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `is_global`.',
    },
    is_locked: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `is_locked`.',
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
    owned_by_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `owned_by_id`.',
    },
    paginate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Set to 'cursor' to opt into the COUNT-free keyset cursor envelope (use for deep traversal); omit for the default offset envelope with total_count. One of `cursor`.",
    },
    parent_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `parent_id`.',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size. Maximum 200 for API v2 and 100 for API v1.',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A search term.',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        '- `all` - All - `public` - Public - `private` - Private - `shared` - Shared - `archived` - Archived One of `all`, `archived`, `private`, `public`, `shared`.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields). Requestable here: `access`, `archived_at`, `collection_id`, `color`, `created_at`, `created_by_id`, `description_html`, `description_stripped`, `external_id`, `external_source`, `id`, `is_global`, `is_locked`, `logo_props`, `name`, `owned_by_id`, `parent_id`, `sort_order`, `view_props`.",
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `owned_by`, `parent`. Expanded relations appear beside their ID fields and survive sparse field filtering. Use only the relation names listed above.',
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
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? [
              'workspace_slug',
              'project_id',
              'type',
              'search',
              'per_page',
              'cursor',
              'expand',
              'fields',
              'external_id',
              'external_source',
              'order_by',
            ]
          : [
              'workspace_slug',
              'project_id',
              'access',
              'collection_id',
              'count',
              'external_id',
              'external_source',
              'is_global',
              'is_locked',
              'offset',
              'order_by',
              'owned_by_id',
              'paginate',
              'parent_id',
              'per_page',
              'search',
              'type',
              'fields',
              'expand',
              'cursor',
            ],
        [
          'workspace_slug',
          'project_id',
          'access',
          'collection_id',
          'count',
          'external_id',
          'external_source',
          'is_global',
          'is_locked',
          'offset',
          'order_by',
          'owned_by_id',
          'paginate',
          'parent_id',
          'per_page',
          'search',
          'type',
          'fields',
          'expand',
          'cursor',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/pages/`,
            planeVersionedValues(params, {
              type: { key: 'type', type: 'string', required: false },
              search: { key: 'search', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              cursor: { key: 'cursor', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/pages/`,
            planeVersionedValues(params, {
              access: { key: 'access', type: 'integer', required: false },
              collection_id: { key: 'collection_id', type: 'string', required: false },
              count: { key: 'count', type: 'boolean', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              is_global: { key: 'is_global', type: 'boolean', required: false },
              is_locked: { key: 'is_locked', type: 'boolean', required: false },
              offset: { key: 'offset', type: 'integer', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              owned_by_id: { key: 'owned_by_id', type: 'string', required: false },
              paginate: { key: 'paginate', type: 'string', required: false },
              parent_id: { key: 'parent_id', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              search: { key: 'search', type: 'string', required: false },
              type: { key: 'type', type: 'string', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
              cursor: { key: 'cursor', type: 'string', required: false },
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
      ? planeListResponse(response, planePageContentSchema, true, false)
      : planeObjectResponse(response, planeV2V2ListProjectPagesresultSchema),
  outputs: {
    result: PLANEV2V2LISTPROJECTPAGESRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: PLANEPAGECONTENT_OUTPUT.type,
        description: PLANEPAGECONTENT_OUTPUT.description,
        properties: PLANEPAGECONTENT_OUTPUT.properties,
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
