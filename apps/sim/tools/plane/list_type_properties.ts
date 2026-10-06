import { PLANEV2V2LISTTYPEPROPERTIESRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ListTypePropertiesresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneListTypePropertiesParams,
  PlaneListTypePropertiesResponse,
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

export const planeListTypePropertiesTool: ToolConfig<
  PlaneListTypePropertiesParams,
  PlaneListTypePropertiesResponse
> = {
  id: 'plane_list_type_properties',
  name: 'Plane List type properties',
  description: 'List type properties in Plane. Requires API v2.',
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
      description: 'The project the work item type belongs to.',
    },
    type_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The work item type whose properties you want to list.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return on each row. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `created_at`, `default_value`, `description`, `display_name`, `external_id`, `external_source`, `id`, `is_active`, `is_multi`, `is_required`, `logo_props`, `name`, `options`, `property_type`, `relation_type`, `settings`, `validation_rules`. See [Sparse fields](/api-reference/v2/sparse-fields).',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Field to sort by. Prefix with `-` for descending. - `sort_order` , `-sort_order` — the order the properties are shown in, and the default - `created_at` , `-created_at` — when each property was created - `id` , `-id` Order by `sort_order` when you are rendering the type's form to a user; it is the order Plane itself uses. Note that `sort_order` is not part of the returned property object — sort by `created_at` or `id` if you need the sort key to be visible in the payload.",
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Page size. Defaults to 50, maximum 200. Most types carry a handful of properties, so one page is usually the whole set.',
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
        'Set to `cursor` to opt into the COUNT-free keyset envelope, which returns `next_cursor` and `has_more` instead of `next` and `total_count`. Pair it with `order_by=created_at` or `order_by=id` — the default `sort_order` is not a unique key, so it is not cursor-eligible. Omit the parameter for the default offset envelope.',
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
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-types/${safeUrlPathSegment(params.type_id, 'type_id')}/properties/`,
        planeVersionedValues(params, {
          fields: { key: 'fields', type: 'string', required: false },
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
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2ListTypePropertiesresultSchema),
  outputs: { result: PLANEV2V2LISTTYPEPROPERTIESRESULT_OUTPUT },
}
