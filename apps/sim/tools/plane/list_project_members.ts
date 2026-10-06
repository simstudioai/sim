import {
  PLANEV2V2LISTPROJECTMEMBERSRESULT_OUTPUT,
  PROJECTMEMBER_OUTPUT,
} from '@/tools/plane/outputs'
import { planeV2V2ListProjectMembersresultSchema, projectMemberSchema } from '@/tools/plane/schemas'
import type {
  PlaneListProjectMembersParams,
  PlaneListProjectMembersResponse,
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

export const planeListProjectMembersTool: ToolConfig<
  PlaneListProjectMembersParams,
  PlaneListProjectMembersResponse
> = {
  id: 'plane_list_project_members',
  name: 'Plane List project members',
  description: 'List project members in Plane. Supports API v1 compatibility.',
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
        'The project whose roster you want. A project id from another workspace returns `404`.',
    },
    member_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return the membership for one user. Use `member_id__in` to check several at once, comma-separated. Pairing `?member_id=` with `?per_page=1` is the cheapest membership check there is: an empty `data` array means that user is not on this project.',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only members holding this role slug, for example `?role=contributor`. Use `role__in` for several roles at once, comma-separated. The value is a plain string, not a fixed enum — a custom role is matched by its own slug.',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "A search term matched against the member's user record, so you can find someone by name or email without expanding first.",
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return on each row. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `id`, `member_id`, `role`. See [Sparse fields](/api-reference/v2/sparse-fields).',
    },
    member_id__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented filter variant. Return the membership for one user. Use `member_id__in` to check several at once, comma-separated. Pairing `?member_id=` with `?per_page=1` is the cheapest membership check there is: an empty `data` array means that user is not on this project.',
    },
    role__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented filter variant. Return only members holding this role slug, for example `?role=contributor`. Use `role__in` for several roles at once, comma-separated. The value is a plain string, not a fixed enum — a custom role is matched by its own slug.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated relations to embed alongside the ids: `member` (the member's user object). Expansion is separate-key: `?expand=state` keeps `state_id` and adds a `state` object next to it, so an id is never replaced by an object. An unknown value is a `400`. `?fields=` and `?expand=` are independent namespaces. Relation names are not valid `?fields=` tokens (and vice versa), and an expanded object survives field filtering — `?fields=id,name&expand=state` returns `id`, `name` and `state`. See [Expanding relations](/api-reference/v2/expanding-relations).",
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field to sort by. Prefix with `-` for descending. - `created_at` , `-created_at` — when the person was added to the project - `id` , `-id`',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Page size. Defaults to 50, maximum 200. Most project rosters fit in a single page.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of rows to skip from the start of the result set. Maximum 10000. Read `next` from the response rather than computing offsets yourself.',
    },
    paginate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to `cursor` for the COUNT-free keyset envelope, which returns `next_cursor` and `has_more` instead of `next` and `total_count`.',
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
          ? ['project_id', 'workspace_slug']
          : [
              'workspace_slug',
              'project_id',
              'member_id',
              'role',
              'search',
              'fields',
              'member_id__in',
              'role__in',
              'expand',
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
          'member_id',
          'role',
          'search',
          'fields',
          'member_id__in',
          'role__in',
          'expand',
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
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/project-members/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/members/`,
            planeVersionedValues(params, {
              member_id: { key: 'member_id', type: 'string', required: false },
              role: { key: 'role', type: 'string', required: false },
              search: { key: 'search', type: 'string', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              member_id__in: { key: 'member_id__in', type: 'string', required: false },
              role__in: { key: 'role__in', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
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
      ? planeListResponse(response, projectMemberSchema, false, true)
      : planeObjectResponse(response, planeV2V2ListProjectMembersresultSchema),
  outputs: {
    result: PLANEV2V2LISTPROJECTMEMBERSRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: PROJECTMEMBER_OUTPUT.type,
        description: PROJECTMEMBER_OUTPUT.description,
        properties: PROJECTMEMBER_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
