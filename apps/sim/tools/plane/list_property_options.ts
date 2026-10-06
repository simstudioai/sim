import {
  PLANEV2V2LISTPROPERTYOPTIONSRESULT_OUTPUT,
  WORKITEMPROPERTYOPTION62BF89_OUTPUT,
} from '@/tools/plane/outputs'
import {
  planeV2V2ListPropertyOptionsresultSchema,
  workItemPropertyOption62bf89Schema,
} from '@/tools/plane/schemas'
import type {
  PlaneListPropertyOptionsParams,
  PlaneListPropertyOptionsResponse,
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

export const planeListPropertyOptionsTool: ToolConfig<
  PlaneListPropertyOptionsParams,
  PlaneListPropertyOptionsResponse
> = {
  id: 'plane_list_property_options',
  name: 'Plane List property options',
  description: 'List property options in Plane. Supports API v1 compatibility.',
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
      description: 'The project that owns the property.',
    },
    property_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The property whose options you want to list. A property id from another project returns `404`, even inside the same workspace.',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Field to sort by. Prefix with `-` for descending. - `sort_order` , `-sort_order` — the order the property itself presents its choices in - `created_at` , `-created_at` — when each option was added - `id` , `-id` Order by `sort_order` when you are rendering the picker to a user; it matches what Plane's own UI shows. `created_at` is orderable but is not returned in the response body.",
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Page size. Defaults to 50, maximum 200. Most properties have well under 50 options, so one page is usually the entire list.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of rows to skip from the start of the result set. Maximum 10000. Read the `next` value from the response rather than computing offsets yourself.',
    },
    paginate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to `cursor` to opt into the COUNT-free keyset envelope, which returns `next_cursor` and `has_more` instead of `next` and `total_count`. Omit it for the default offset envelope.',
    },
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Defaults to `true`. Set to `false` to skip the `COUNT(*)` behind `total_count`; the field is then omitted from the response.',
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
          ? ['project_id', 'property_id', 'workspace_slug']
          : [
              'workspace_slug',
              'project_id',
              'property_id',
              'order_by',
              'per_page',
              'offset',
              'paginate',
              'count',
              'cursor',
            ],
        [
          'workspace_slug',
          'project_id',
          'property_id',
          'order_by',
          'per_page',
          'offset',
          'paginate',
          'count',
          'cursor',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/options/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/options/`,
            planeVersionedValues(params, {
              order_by: { key: 'order_by', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              offset: { key: 'offset', type: 'integer', required: false },
              paginate: { key: 'paginate', type: 'string', required: false },
              count: { key: 'count', type: 'boolean', required: false },
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
      ? planeListResponse(response, workItemPropertyOption62bf89Schema, false, false)
      : planeObjectResponse(response, planeV2V2ListPropertyOptionsresultSchema),
  outputs: {
    result: PLANEV2V2LISTPROPERTYOPTIONSRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: WORKITEMPROPERTYOPTION62BF89_OUTPUT.type,
        description: WORKITEMPROPERTYOPTION62BF89_OUTPUT.description,
        properties: WORKITEMPROPERTYOPTION62BF89_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
