import { PLANEV2V2LISTWORKSPACEPROPERTYOPTIONSRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ListWorkspacePropertyOptionsresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneListWorkspacePropertyOptionsParams,
  PlaneListWorkspacePropertyOptionsResponse,
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

export const planeListWorkspacePropertyOptionsTool: ToolConfig<
  PlaneListWorkspacePropertyOptionsParams,
  PlaneListWorkspacePropertyOptionsResponse
> = {
  id: 'plane_list_workspace_property_options',
  name: 'Plane List workspace property options',
  description: 'List workspace property options in Plane. Requires API v2.',
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
    property_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "The workspace-level property whose options you want — see [Workspace work item properties](/api-reference/v2/workspace-work-item-properties/overview). This endpoint filters options by property rather than looking the property up, so an id that isn't a workspace-level property in this workspace — including a project-scoped property id — comes back as an empty list, not a `404`.",
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Field to sort by. Prefix with `-` for descending. - `sort_order` , `-sort_order` — the property's own display order. This is the default. - `created_at` , `-created_at` — when each option was added - `id` , `-id` A value outside this list is ignored and the default `sort_order` ordering is used, so a typo shows up as an unexpected order rather than an error.",
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Page size. Defaults to 50, maximum 200. Most properties have fewer than 20 options, so one page is usually the whole list.',
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
        'Set to `cursor` to opt into the COUNT-free keyset envelope, which returns `next_cursor` and `has_more` instead of `next` and `total_count`. Omit it for the default offset envelope. Cursor pagination needs a unique, monotonic sort key, and `sort_order` is neither. Pair it with `order_by=created_at` or `order_by=id`; a bare `?paginate=cursor` falls back to the default `sort_order` ordering and is rejected with `ordering_not_cursor_eligible`.',
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
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/options/`,
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
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2ListWorkspacePropertyOptionsresultSchema),
  outputs: { result: PLANEV2V2LISTWORKSPACEPROPERTYOPTIONSRESULT_OUTPUT },
}
