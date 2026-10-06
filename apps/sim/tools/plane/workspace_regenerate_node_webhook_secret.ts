import { PLANEV2V2WORKSPACEREGENERATENODEWEBHOOKSECRETRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2WorkspaceRegenerateNodeWebhookSecretresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneWorkspaceRegenerateNodeWebhookSecretParams,
  PlaneWorkspaceRegenerateNodeWebhookSecretResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeWorkspaceRegenerateNodeWebhookSecretTool: ToolConfig<
  PlaneWorkspaceRegenerateNodeWebhookSecretParams,
  PlaneWorkspaceRegenerateNodeWebhookSecretResponse
> = {
  id: 'plane_workspace_regenerate_node_webhook_secret',
  name: 'Plane Regenerate an workspace automation node webhook secret',
  description: 'Regenerate an workspace automation node webhook secret in Plane. Requires API v2.',
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
    automation_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The automation the resource belongs to.',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The automation node id.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/automations/${safeUrlPathSegment(params.automation_id, 'automation_id')}/nodes/${safeUrlPathSegment(params.pk, 'pk')}/regenerate-webhook-secret/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2WorkspaceRegenerateNodeWebhookSecretresultSchema),
  outputs: { result: PLANEV2V2WORKSPACEREGENERATENODEWEBHOOKSECRETRESULT_OUTPUT },
}
