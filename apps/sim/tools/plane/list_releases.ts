import { PLANEV2V2LISTRELEASESRESULT_OUTPUT, RELEASE55EE53_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ListReleasesresultSchema, release55ee53Schema } from '@/tools/plane/schemas'
import type { PlaneListReleasesParams, PlaneListReleasesResponse } from '@/tools/plane/types'
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

export const planeListReleasesTool: ToolConfig<PlaneListReleasesParams, PlaneListReleasesResponse> =
  {
    id: 'plane_list_releases',
    name: 'Plane List releases',
    description: 'List releases in Plane. Supports API v1 compatibility.',
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
      is_latest: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `is_latest`.',
      },
      is_prerelease: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `is_prerelease`.',
      },
      lead_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `lead_id`.',
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
      release_date: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `release_date`.',
      },
      search: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'A search term.',
      },
      status: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          '- `unreleased` - Unreleased - `released` - Released - `cancelled` - Cancelled One of `cancelled`, `released`, `unreleased`.',
      },
      status__in: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Multiple values may be separated by commas. - `unreleased` - Unreleased - `released` - Released - `cancelled` - Cancelled',
      },
      tag_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `tag_id`.',
      },
      target_date: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `target_date`.',
      },
      fields: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `description_html`, `description_id`, `external_id`, `external_source`, `id`, `is_latest`, `is_prerelease`, `label_ids`, `lead_id`, `name`, `release_date`, `status`, `tag_id`, `target_date`.",
      },
      expand: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated relations to embed: `lead`, `tag`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
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
            ? ['workspace_slug', 'per_page', 'cursor']
            : [
                'workspace_slug',
                'count',
                'is_latest',
                'is_prerelease',
                'lead_id',
                'name',
                'offset',
                'order_by',
                'paginate',
                'per_page',
                'release_date',
                'search',
                'status',
                'status__in',
                'tag_id',
                'target_date',
                'fields',
                'expand',
                'cursor',
              ],
          [
            'workspace_slug',
            'count',
            'is_latest',
            'is_prerelease',
            'lead_id',
            'name',
            'offset',
            'order_by',
            'paginate',
            'per_page',
            'release_date',
            'search',
            'status',
            'status__in',
            'tag_id',
            'target_date',
            'fields',
            'expand',
            'cursor',
          ],
          version
        )
        return version === 'v1'
          ? planeApiUrl(
              params.baseUrl,
              `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/`,
              planeVersionedValues(params, {
                per_page: { key: 'per_page', type: 'integer', required: false },
                cursor: { key: 'cursor', type: 'string', required: false },
              })
            )
          : planeApiUrl(
              params.baseUrl,
              `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/`,
              planeVersionedValues(params, {
                count: { key: 'count', type: 'boolean', required: false },
                is_latest: { key: 'is_latest', type: 'boolean', required: false },
                is_prerelease: { key: 'is_prerelease', type: 'boolean', required: false },
                lead_id: { key: 'lead_id', type: 'string', required: false },
                name: { key: 'name', type: 'string', required: false },
                offset: { key: 'offset', type: 'integer', required: false },
                order_by: { key: 'order_by', type: 'string', required: false },
                paginate: { key: 'paginate', type: 'string', required: false },
                per_page: { key: 'per_page', type: 'integer', required: false },
                release_date: { key: 'release_date', type: 'string', required: false },
                search: { key: 'search', type: 'string', required: false },
                status: { key: 'status', type: 'string', required: false },
                status__in: { key: 'status__in', type: 'array', required: false },
                tag_id: { key: 'tag_id', type: 'string', required: false },
                target_date: { key: 'target_date', type: 'string', required: false },
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
        ? planeListResponse(response, release55ee53Schema, true, false)
        : planeObjectResponse(response, planeV2V2ListReleasesresultSchema),
    outputs: {
      result: PLANEV2V2LISTRELEASESRESULT_OUTPUT,
      results: {
        type: 'array',
        optional: true,
        description: 'Returned Plane records.',
        items: {
          type: RELEASE55EE53_OUTPUT.type,
          description: RELEASE55EE53_OUTPUT.description,
          properties: RELEASE55EE53_OUTPUT.properties,
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
