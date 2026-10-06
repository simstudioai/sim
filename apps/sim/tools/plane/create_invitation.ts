import { PLANEV2INVITATIONSD40DEA_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Invitationsd40deaSchema } from '@/tools/plane/schemas'
import type {
  PlaneCreateInvitationParams,
  PlaneCreateInvitationResponse,
} from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
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

export const planeCreateInvitationTool: ToolConfig<
  PlaneCreateInvitationParams,
  PlaneCreateInvitationResponse
> = {
  id: 'plane_create_invitation',
  name: 'Plane Create an invitation',
  description: 'Create an invitation in Plane. Supports API v1 compatibility.',
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
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address.',
    },
    message: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The message. Nullable.',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Role to grant.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `accepted`, `created_at`, `created_by_id`, `email`, `id`, `message`, `responded_at`, `role`.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'email', 'role']
          : ['workspace_slug', 'email', 'message', 'role', 'fields'],
        ['workspace_slug', 'email', 'message', 'role', 'fields'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/invitations/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/invitations/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
            })
          )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            {
              email: { key: 'email', type: 'string', required: true },
              role: { key: 'role', type: 'integer', required: false, roleMap: true },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              email: { key: 'email', type: 'string', required: true },
              message: { key: 'message', type: 'string', required: false },
              role: { key: 'role', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2Invitationsd40deaSchema)
      : planeObjectResponse(response, planeV2Invitationsd40deaSchema),
  outputs: { result: PLANEV2INVITATIONSD40DEA_OUTPUT },
}
