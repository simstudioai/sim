import {
  PLANEV2V2LISTWORKSPACEMEMBERSRESULT_OUTPUT,
  WORKSPACEMEMBER_OUTPUT,
} from '@/tools/plane/outputs'
import {
  planeV2V2ListWorkspaceMembersresultSchema,
  workspaceMemberSchema,
} from '@/tools/plane/schemas'
import type {
  PlaneListWorkspaceMembersParams,
  PlaneListWorkspaceMembersResponse,
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

export const planeListWorkspaceMembersTool: ToolConfig<
  PlaneListWorkspaceMembersParams,
  PlaneListWorkspaceMembersResponse
> = {
  id: 'plane_list_workspace_members',
  name: 'Plane List workspace members',
  description: 'List workspace members in Plane. Supports API v1 compatibility.',
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
    member_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return the membership for one user. Use the `member_id__in` variant to look several users up at once, comma-separated — `?member_id__in=16c61a3a-512a-48ac-b0be-b6b46fe6f430,7f2b9e04-6c1d-4a58-9e3b-0d4c8a2f6b71`. This is the cheap way to answer "is this person still in the workspace, and what is their role now?" without paging the whole roster.',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only members holding this role slug, for example `?role=owner`. Use `role__in` for several roles at once, comma-separated. The value is a plain string, not a fixed enum — custom roles are matched by their own slug.',
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
        'Documented filter variant. Return the membership for one user. Use the `member_id__in` variant to look several users up at once, comma-separated — `?member_id__in=16c61a3a-512a-48ac-b0be-b6b46fe6f430,7f2b9e04-6c1d-4a58-9e3b-0d4c8a2f6b71`. This is the cheap way to answer "is this person still in the workspace, and what is their role now?" without paging the whole roster.',
    },
    role__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented filter variant. Return only members holding this role slug, for example `?role=owner`. Use `role__in` for several roles at once, comma-separated. The value is a plain string, not a fixed enum — custom roles are matched by their own slug.',
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
        'Field to sort by. Prefix with `-` for descending. - `created_at` , `-created_at` — when the person joined the workspace - `id` , `-id` There is no ordering by name or role; sort the page client-side, or expand and sort on `display_name`.',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size. Defaults to 50, maximum 200.',
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
        'Set to `cursor` for the COUNT-free keyset envelope, which returns `next_cursor` and `has_more` instead of `next` and `total_count`. Worth it when you are walking a large workspace end to end.',
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
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. External system identifier for filtering or lookup',
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. External system source name for filtering or lookup',
    },
    first_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Filter by member first name (case-insensitive contains)',
    },
    last_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Filter by member last name (case-insensitive contains)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Filter by member email (case-insensitive contains)',
    },
    display_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. Filter by member display name (case-insensitive contains)',
    },
    role_slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Filter by role slug (exact match)',
    },
    is_active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Filter by active membership status',
    },
    is_bot: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Filter by bot accounts',
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
              'expand',
              'fields',
              'external_id',
              'external_source',
              'order_by',
              'first_name',
              'last_name',
              'email',
              'display_name',
              'role_slug',
              'is_active',
              'is_bot',
            ]
          : [
              'workspace_slug',
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
          'external_id',
          'external_source',
          'first_name',
          'last_name',
          'email',
          'display_name',
          'role_slug',
          'is_active',
          'is_bot',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/members/`,
            planeVersionedValues(params, {
              expand: { key: 'expand', type: 'string', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              first_name: { key: 'first_name', type: 'string', required: false },
              last_name: { key: 'last_name', type: 'string', required: false },
              email: { key: 'email', type: 'string', required: false },
              display_name: { key: 'display_name', type: 'string', required: false },
              role_slug: { key: 'role_slug', type: 'string', required: false },
              is_active: { key: 'is_active', type: 'boolean', required: false },
              is_bot: { key: 'is_bot', type: 'boolean', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/members/`,
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
      ? planeListResponse(response, workspaceMemberSchema, false, false)
      : planeObjectResponse(response, planeV2V2ListWorkspaceMembersresultSchema),
  outputs: {
    result: PLANEV2V2LISTWORKSPACEMEMBERSRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: WORKSPACEMEMBER_OUTPUT.type,
        description: WORKSPACEMEMBER_OUTPUT.description,
        properties: WORKSPACEMEMBER_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
