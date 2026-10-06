import { PLANEV2V2LISTAUDITLOGSRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ListAuditLogsresultSchema } from '@/tools/plane/schemas'
import type { PlaneListAuditLogsParams, PlaneListAuditLogsResponse } from '@/tools/plane/types'
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

export const planeListAuditLogsTool: ToolConfig<
  PlaneListAuditLogsParams,
  PlaneListAuditLogsResponse
> = {
  id: 'plane_list_audit_logs',
  name: 'Plane List audit logs',
  description: 'List audit logs in Plane. Requires API v2.',
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
    created_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return entries recorded from this timestamp onward, for example `2026-01-01T00:00:00Z`. Pair it with `created_before` to bound a review period.',
    },
    created_before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return entries recorded up to this timestamp. Send timestamps in UTC — `created_at` is returned in UTC, and mixing offsets is the usual reason a window looks empty.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return on each row. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `actor_display_name`, `actor_email`, `actor_id`, `actor_type`, `category`, `created_at`, `event_id`, `event_name`, `id`, `ip_address`, `metadata`, `new_value`, `old_value`, `outcome`, `project_id`, `reason`, `sequence_number`, `source`, `target_display_name`, `target_id`, `target_type`, `user_agent`, `workspace_id`. See [Sparse fields](/api-reference/v2/sparse-fields).',
    },
    actor_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only what one user did. This is the same id as `member_id` on the [member rosters](/api-reference/v2/members/overview), so an access certification is a roster read followed by one call per person. Entries with no actor — `system` and `anonymous` events — are excluded by any `actor_id` filter, so run a second unfiltered query if you are asked to account for everything in a window.',
    },
    event_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only one specific event, for example `member.role_updated`. Use it when you already know the action you are hunting for; use `category` when you want a whole class of them.',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only one family of events: `auth`, `member`, `role`, `settings`, `integration`, `webhook`, `security`, or `instance`. `role` and `member` answer "who gained access and when". `settings` answers "what changed about this workspace". `auth` plus `outcome=failure` answers "who tried to get in".',
    },
    outcome: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only entries with this outcome: `success` or `failure`. Failed attempts are recorded, which is what makes this filter the fastest way to spot probing.',
    },
    target_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only entries acting on this kind of object, for example `workspace_member`. Combine it with `target_id` to build the history of a single record.',
    },
    target_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only entries acting on this specific object. `?target_type=…&target_id=…` is the "everything that ever happened to this thing" query.',
    },
    ip_address: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only entries recorded from this client IP. Start from a suspicious entry, then pivot on its `ip_address` to see everything else that address did.',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A free-text search term across the entry. Reach for it when you have a name or a fragment rather than an id.',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field to sort by. Prefix with `-` for descending. - `-created_at` , `created_at` — newest first, or oldest first - `id` , `-id` Use `-created_at` for an investigation, `created_at` for a replayable export. Two entries written in the same instant are separated by `sequence_number` in the payload.',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size. Defaults to 50, maximum 200. Use 200 for exports.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of rows to skip from the start of the result set. Maximum 10000 — which an audit trail exceeds quickly, so use cursor pagination for anything deeper than a few pages.',
    },
    paginate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to `cursor` for the COUNT-free keyset envelope, which returns `next_cursor` and `has_more` instead of `next` and `total_count`. This is the mode to use for a full export: it has no offset ceiling and it does not skip or repeat rows as new entries land mid-walk.',
    },
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Defaults to `true`. Set to `false` to skip the `COUNT(*)` behind `total_count`; the field is then omitted. Worth doing on every page of an offset walk — cursor pagination never runs a `COUNT` and ignores this parameter.',
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
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/audit-logs/`,
        planeVersionedValues(params, {
          created_after: { key: 'created_after', type: 'string', required: false },
          created_before: { key: 'created_before', type: 'string', required: false },
          fields: { key: 'fields', type: 'string', required: false },
          actor_id: { key: 'actor_id', type: 'string', required: false },
          event_name: { key: 'event_name', type: 'string', required: false },
          category: { key: 'category', type: 'string', required: false },
          outcome: { key: 'outcome', type: 'string', required: false },
          target_type: { key: 'target_type', type: 'string', required: false },
          target_id: { key: 'target_id', type: 'string', required: false },
          ip_address: { key: 'ip_address', type: 'string', required: false },
          search: { key: 'search', type: 'string', required: false },
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
    planeObjectResponse(response, planeV2V2ListAuditLogsresultSchema),
  outputs: { result: PLANEV2V2LISTAUDITLOGSRESULT_OUTPUT },
}
