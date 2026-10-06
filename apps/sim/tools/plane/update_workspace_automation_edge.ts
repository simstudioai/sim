import { PLANEV2WORKSPACEAUTOMATIONS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkspaceAutomationsSchema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateWorkspaceAutomationEdgeParams,
  PlaneUpdateWorkspaceAutomationEdgeResponse,
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

export const planeUpdateWorkspaceAutomationEdgeTool: ToolConfig<
  PlaneUpdateWorkspaceAutomationEdgeParams,
  PlaneUpdateWorkspaceAutomationEdgeResponse
> = {
  id: 'plane_update_workspace_automation_edge',
  name: 'Plane Update an workspace automation edge',
  description: 'Update an workspace automation edge in Plane. Requires API v2.',
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
    execution_order: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order for evaluation when multiple edges from same node',
    },
    source_node_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related source node.',
    },
    target_node_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related target node.',
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
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          execution_order: { key: 'execution_order', type: 'integer', required: false },
          source_node_id: { key: 'source_node_id', type: 'string', required: false },
          target_node_id: { key: 'target_node_id', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2WorkspaceAutomationsSchema),
  outputs: { result: PLANEV2WORKSPACEAUTOMATIONS_OUTPUT },
}
