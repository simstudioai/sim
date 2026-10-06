import { PLANEV2AUDITLOGS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2AuditLogsSchema } from '@/tools/plane/schemas'
import type { PlaneGetAuditLogParams, PlaneGetAuditLogResponse } from '@/tools/plane/types'
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

export const planeGetAuditLogTool: ToolConfig<PlaneGetAuditLogParams, PlaneGetAuditLogResponse> = {
  id: 'plane_get_audit_log',
  name: 'Plane Get an audit log',
  description: 'Get an audit log in Plane. Requires API v2.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "The id of the audit log entry to retrieve. This is the entry's `id`, not its `event_id`.",
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `actor_display_name`, `actor_email`, `actor_id`, `actor_type`, `category`, `created_at`, `event_id`, `event_name`, `id`, `ip_address`, `metadata`, `new_value`, `old_value`, `outcome`, `project_id`, `reason`, `sequence_number`, `source`, `target_display_name`, `target_id`, `target_type`, `user_agent`, `workspace_id`. See [Sparse fields](/api-reference/v2/sparse-fields).',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/audit-logs/${safeUrlPathSegment(params.pk, 'pk')}/`,
        planeVersionedValues(params, { fields: { key: 'fields', type: 'string', required: false } })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) => planeObjectResponse(response, planeV2AuditLogsSchema),
  outputs: { result: PLANEV2AUDITLOGS_OUTPUT },
}
