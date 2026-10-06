import { PLANEV2PROJECTAUTOMATIONS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2ProjectAutomationsSchema } from '@/tools/plane/schemas'
import type {
  PlaneCreateProjectAutomationEdgeParams,
  PlaneCreateProjectAutomationEdgeResponse,
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

export const planeCreateProjectAutomationEdgeTool: ToolConfig<
  PlaneCreateProjectAutomationEdgeParams,
  PlaneCreateProjectAutomationEdgeResponse
> = {
  id: 'plane_create_project_automation_edge',
  name: 'Plane Create an project automation edge',
  description: 'Create an project automation edge in Plane. Requires API v2.',
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
    source_node_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Id of the related source node.',
    },
    target_node_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Id of the related target node.',
    },
    execution_order: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order for evaluation when multiple edges from same node',
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
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/automations/${safeUrlPathSegment(params.automation_id, 'automation_id')}/edges/`,
        planeVersionedValues(params, { fields: { key: 'fields', type: 'string', required: false } })
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          source_node_id: { key: 'source_node_id', type: 'string', required: true },
          target_node_id: { key: 'target_node_id', type: 'string', required: true },
          execution_order: { key: 'execution_order', type: 'integer', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2ProjectAutomationsSchema),
  outputs: { result: PLANEV2PROJECTAUTOMATIONS_OUTPUT },
}
