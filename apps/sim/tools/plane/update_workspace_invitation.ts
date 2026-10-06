import { PLANEUPDATEWORKSPACEINVITATIONRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeUpdateWorkspaceInvitationResultSchema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateWorkspaceInvitationParams,
  PlaneUpdateWorkspaceInvitationResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  planeApiUrl,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeUpdateWorkspaceInvitationTool: ToolConfig<
  PlaneUpdateWorkspaceInvitationParams,
  PlaneUpdateWorkspaceInvitationResponse
> = {
  id: 'plane_update_workspace_invitation',
  name: 'Plane v1 only: Update workspace invitation',
  description: 'v1 only: Update workspace invitation in Plane. Requires API v1.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    bodyOverrides: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON overrides using the canonical input names for the selected API version. Preserves empty strings, null, and empty arrays; unsupported fields are rejected.',
    },
    invitation_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the invitation.',
    },
    workspace_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace slug from the Plane URL (for example, my-team).',
    },
    role: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: '- `20` - Admin - `15` - Member - `5` - Guest',
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/invitations/${safeUrlPathSegment(params.invitation_id, 'invitation_id')}/`
      )
    },
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        { role: { key: 'role', type: 'integer', required: false } },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeUpdateWorkspaceInvitationResultSchema),
  outputs: { result: PLANEUPDATEWORKSPACEINVITATIONRESULT_OUTPUT },
}
