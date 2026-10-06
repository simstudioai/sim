import {
  ESTIMATEPOINTBB0EE0_OUTPUT,
  PLANEV2V2LISTESTIMATEPOINTSRESULT_OUTPUT,
} from '@/tools/plane/outputs'
import {
  estimatePointbb0ee0Schema,
  planeV2V2ListEstimatePointsresultSchema,
} from '@/tools/plane/schemas'
import type {
  PlaneListEstimatePointsParams,
  PlaneListEstimatePointsResponse,
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

export const planeListEstimatePointsTool: ToolConfig<
  PlaneListEstimatePointsParams,
  PlaneListEstimatePointsResponse
> = {
  id: 'plane_list_estimate_points',
  name: 'Plane List estimate points',
  description: 'List estimate points in Plane. Supports API v1 compatibility.',
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
    estimate_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The estimate the points belong to.',
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
    key: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `key`.',
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
    value: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `value`.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `description`, `estimate_id`, `external_id`, `external_source`, `id`, `key`, `value`.",
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
          ? ['estimate_id', 'project_id', 'workspace_slug']
          : [
              'workspace_slug',
              'project_id',
              'estimate_id',
              'count',
              'external_id',
              'external_source',
              'key',
              'offset',
              'order_by',
              'paginate',
              'per_page',
              'search',
              'value',
              'fields',
              'cursor',
            ],
        [
          'workspace_slug',
          'project_id',
          'estimate_id',
          'count',
          'external_id',
          'external_source',
          'key',
          'offset',
          'order_by',
          'paginate',
          'per_page',
          'search',
          'value',
          'fields',
          'cursor',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/estimates/${safeUrlPathSegment(params.estimate_id, 'estimate_id')}/estimate-points/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/estimates/${safeUrlPathSegment(params.estimate_id, 'estimate_id')}/points/`,
            planeVersionedValues(params, {
              count: { key: 'count', type: 'boolean', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              key: { key: 'key', type: 'integer', required: false },
              offset: { key: 'offset', type: 'integer', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              paginate: { key: 'paginate', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              search: { key: 'search', type: 'string', required: false },
              value: { key: 'value', type: 'string', required: false },
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
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeListResponse(response, estimatePointbb0ee0Schema, false, false)
      : planeObjectResponse(response, planeV2V2ListEstimatePointsresultSchema),
  outputs: {
    result: PLANEV2V2LISTESTIMATEPOINTSRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: ESTIMATEPOINTBB0EE0_OUTPUT.type,
        description: ESTIMATEPOINTBB0EE0_OUTPUT.description,
        properties: ESTIMATEPOINTBB0EE0_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
