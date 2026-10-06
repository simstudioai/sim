import { PLANEV2WORKSPACEAUTOMATIONS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkspaceAutomationsSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetWorkspaceAutomationEdgeParams,
  PlaneGetWorkspaceAutomationEdgeResponse,
} from '@/tools/plane/types'
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

export const planeGetWorkspaceAutomationEdgeTool: ToolConfig<
  PlaneGetWorkspaceAutomationEdgeParams,
  PlaneGetWorkspaceAutomationEdgeResponse
> = {
  id: 'plane_get_workspace_automation_edge',
  name: 'Plane Get an workspace automation edge',
  description: 'Get an workspace automation edge in Plane. Requires API v2.',
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
      description: 'The automation edge id.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `execution_order`, `id`, `source_node_id`, `target_node_id`, `updated_at`, `version_id`.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/automations/${safeUrlPathSegment(params.automation_id, 'automation_id')}/edges/${safeUrlPathSegment(params.pk, 'pk')}/`,
        planeVersionedValues(params, { fields: { key: 'fields', type: 'string', required: false } })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2WorkspaceAutomationsSchema),
  outputs: { result: PLANEV2WORKSPACEAUTOMATIONS_OUTPUT },
}
