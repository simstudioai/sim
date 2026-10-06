import { PLANEV2V2BULKINVITATIONSRESULTITEM_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2BulkInvitationsresultitemSchema } from '@/tools/plane/schemas'
import type { PlaneBulkInvitationsParams, PlaneBulkInvitationsResponse } from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeListResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeBulkInvitationsTool: ToolConfig<
  PlaneBulkInvitationsParams,
  PlaneBulkInvitationsResponse
> = {
  id: 'plane_bulk_invitations',
  name: 'Plane Bulk invite members',
  description: 'Bulk invite members in Plane. Requires API v2.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    apiVersion: PLANE_VERSION_PARAM,
    bodyOverrides: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON overrides using the canonical input names for the selected API version. Preserves empty strings, null, and empty arrays; unsupported fields are rejected.',
    },
    workspace_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace slug from the Plane URL (for example, my-team).',
    },
    emails: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The addresses to invite, at most **100** per call. Each must be a valid, non-empty email address — one malformed entry is a `400` for the whole request, so nothing is sent.',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The role every invitee receives. One of `admin`, `member`, or `guest`. Defaults to `member`. There is no way to give different invitees different roles in one call — send one request per role.',
    },
    message: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A note included in the invitation email, shown to every invitee in this batch.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/invitations/bulk/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          emails: { key: 'emails', type: 'array', required: true },
          role: { key: 'role', type: 'string', required: false },
          message: { key: 'message', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeListResponse(response, planeV2V2BulkInvitationsresultitemSchema, false, false),
  outputs: {
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: PLANEV2V2BULKINVITATIONSRESULTITEM_OUTPUT.type,
        description: PLANEV2V2BULKINVITATIONSRESULTITEM_OUTPUT.description,
        properties: PLANEV2V2BULKINVITATIONSRESULTITEM_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
