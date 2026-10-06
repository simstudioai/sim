import { PLANEV2V2PROJECTREGENERATENODEWEBHOOKSECRETRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ProjectRegenerateNodeWebhookSecretresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneProjectRegenerateNodeWebhookSecretParams,
  PlaneProjectRegenerateNodeWebhookSecretResponse,
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

export const planeProjectRegenerateNodeWebhookSecretTool: ToolConfig<
  PlaneProjectRegenerateNodeWebhookSecretParams,
  PlaneProjectRegenerateNodeWebhookSecretResponse
> = {
  id: 'plane_project_regenerate_node_webhook_secret',
  name: 'Plane Regenerate an project automation node webhook secret',
  description: 'Regenerate an project automation node webhook secret in Plane. Requires API v2.',
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
        'The project the resource belongs to. Accepts the project UUID or its bare identifier, for example `ENG`.',
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
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/automations/${safeUrlPathSegment(params.automation_id, 'automation_id')}/nodes/${safeUrlPathSegment(params.pk, 'pk')}/regenerate-webhook-secret/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2ProjectRegenerateNodeWebhookSecretresultSchema),
  outputs: { result: PLANEV2V2PROJECTREGENERATENODEWEBHOOKSECRETRESULT_OUTPUT },
}
