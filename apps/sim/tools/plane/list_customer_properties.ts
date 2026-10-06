import {
  CUSTOMERPROPERTY195984_OUTPUT,
  PLANEV2V2LISTCUSTOMERPROPERTIESRESULT_OUTPUT,
} from '@/tools/plane/outputs'
import {
  customerProperty195984Schema,
  planeV2V2ListCustomerPropertiesresultSchema,
} from '@/tools/plane/schemas'
import type {
  PlaneListCustomerPropertiesParams,
  PlaneListCustomerPropertiesResponse,
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

export const planeListCustomerPropertiesTool: ToolConfig<
  PlaneListCustomerPropertiesParams,
  PlaneListCustomerPropertiesResponse
> = {
  id: 'plane_list_customer_properties',
  name: 'Plane List customer properties',
  description: 'List customer properties in Plane. Supports API v1 compatibility.',
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
    is_required: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `is_required`.',
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
    property_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `property_type`.',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A search term.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `default_value`, `description`, `display_name`, `external_id`, `external_source`, `id`, `is_active`, `is_multi`, `is_required`, `logo_props`, `name`, `options`, `property_type`, `relation_type`, `settings`, `sort_order`, `validation_rules`.",
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
          ? ['workspace_slug', 'cursor', 'per_page']
          : [
              'workspace_slug',
              'count',
              'is_active',
              'is_required',
              'name',
              'offset',
              'order_by',
              'paginate',
              'per_page',
              'property_type',
              'search',
              'fields',
              'cursor',
            ],
        [
          'workspace_slug',
          'count',
          'is_active',
          'is_required',
          'name',
          'offset',
          'order_by',
          'paginate',
          'per_page',
          'property_type',
          'search',
          'fields',
          'cursor',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/customer-properties/`,
            planeVersionedValues(params, {
              cursor: { key: 'cursor', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/customer-properties/`,
            planeVersionedValues(params, {
              count: { key: 'count', type: 'boolean', required: false },
              is_active: { key: 'is_active', type: 'boolean', required: false },
              is_required: { key: 'is_required', type: 'boolean', required: false },
              name: { key: 'name', type: 'string', required: false },
              offset: { key: 'offset', type: 'integer', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              paginate: { key: 'paginate', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              property_type: { key: 'property_type', type: 'string', required: false },
              search: { key: 'search', type: 'string', required: false },
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
      ? planeListResponse(response, customerProperty195984Schema, true, false)
      : planeObjectResponse(response, planeV2V2ListCustomerPropertiesresultSchema),
  outputs: {
    result: PLANEV2V2LISTCUSTOMERPROPERTIESRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: CUSTOMERPROPERTY195984_OUTPUT.type,
        description: CUSTOMERPROPERTY195984_OUTPUT.description,
        properties: CUSTOMERPROPERTY195984_OUTPUT.properties,
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
