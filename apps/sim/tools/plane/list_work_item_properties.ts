import { PLANEV2V2LISTWORKITEMPROPERTIESRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ListWorkItemPropertiesresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneListWorkItemPropertiesParams,
  PlaneListWorkItemPropertiesResponse,
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

export const planeListWorkItemPropertiesTool: ToolConfig<
  PlaneListWorkItemPropertiesParams,
  PlaneListWorkItemPropertiesResponse
> = {
  id: 'plane_list_work_item_properties',
  name: 'Plane List work item properties',
  description: 'List work item properties in Plane. Requires API v2.',
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
      description: 'The project whose properties you want to list.',
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
        'Field to sort by. Prefix with `-` for descending. - `sort_order` , `-sort_order` — the configured display order of the fields - `created_at` , `-created_at` — when each property was defined - `id` , `-id` Order by `sort_order` when you are rendering the fields to a person; it is the order the project itself uses.',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Page size. Defaults to 50, maximum 200. Most projects define far fewer than 50 properties, so one page is usually the whole catalog.',
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
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-properties/`,
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
    planeObjectResponse(response, planeV2V2ListWorkItemPropertiesresultSchema),
  outputs: { result: PLANEV2V2LISTWORKITEMPROPERTIESRESULT_OUTPUT },
}
