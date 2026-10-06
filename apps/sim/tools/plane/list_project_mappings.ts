import {
  PLANELISTPROJECTMAPPINGSRESULTITEM51E494_OUTPUT,
  PLANEV2V2LISTPROJECTMAPPINGSRESULT_OUTPUT,
} from '@/tools/plane/outputs'
import {
  planeListProjectMappingsResultItem51e494Schema,
  planeV2V2ListProjectMappingsresultSchema,
} from '@/tools/plane/schemas'
import type {
  PlaneListProjectMappingsParams,
  PlaneListProjectMappingsResponse,
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

export const planeListProjectMappingsTool: ToolConfig<
  PlaneListProjectMappingsParams,
  PlaneListProjectMappingsResponse
> = {
  id: 'plane_list_project_mappings',
  name: 'Plane List project mappings',
  description: 'List project mappings in Plane. Supports API v1 compatibility.',
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
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `all_projects`, `created_at`, `id`, `idp_group_name`, `project_id`, `role_slug`.",
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Cursor from next_cursor. Repeat the original filters, per_page, and order_by when following it.',
    },
    project_identifier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. Filter mappings to a single project by its identifier (e.g. `ENG`). Case-insensitive — the value is matched against the uppercase project identifier. An unknown identifier returns an empty list.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'project_identifier']
          : [
              'workspace_slug',
              'count',
              'offset',
              'order_by',
              'paginate',
              'per_page',
              'search',
              'fields',
              'cursor',
            ],
        [
          'workspace_slug',
          'count',
          'offset',
          'order_by',
          'paginate',
          'per_page',
          'search',
          'fields',
          'cursor',
          'project_identifier',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/group-sync/project-mappings/`,
            planeVersionedValues(params, {
              project_identifier: { key: 'project_identifier', type: 'string', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/group-sync/project-mappings/`,
            planeVersionedValues(params, {
              count: { key: 'count', type: 'boolean', required: false },
              offset: { key: 'offset', type: 'integer', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              paginate: { key: 'paginate', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
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
      ? planeListResponse(response, planeListProjectMappingsResultItem51e494Schema, false, false)
      : planeObjectResponse(response, planeV2V2ListProjectMappingsresultSchema),
  outputs: {
    result: PLANEV2V2LISTPROJECTMAPPINGSRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: PLANELISTPROJECTMAPPINGSRESULTITEM51E494_OUTPUT.type,
        description: PLANELISTPROJECTMAPPINGSRESULTITEM51E494_OUTPUT.description,
        properties: PLANELISTPROJECTMAPPINGSRESULTITEM51E494_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
