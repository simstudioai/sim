import { PLANEV2PROJECTAUTOMATIONSBFBFC7_OUTPUT } from '@/tools/plane/outputs'
import { planeV2ProjectAutomationsbfbfc7Schema } from '@/tools/plane/schemas'
import type {
  PlaneCreateProjectAutomationNodeParams,
  PlaneCreateProjectAutomationNodeResponse,
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

export const planeCreateProjectAutomationNodeTool: ToolConfig<
  PlaneCreateProjectAutomationNodeParams,
  PlaneCreateProjectAutomationNodeResponse
> = {
  id: 'plane_create_project_automation_node',
  name: 'Plane Create an project automation node',
  description: 'Create an project automation node in Plane. Requires API v2.',
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
    handler_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "Name of the handler class (e.g., 'record_created', 'send_email') Maximum 100 characters.",
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name for the node Maximum 255 characters.',
    },
    node_type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Type of node: trigger, action, or condition - `trigger` - Trigger - `action` - Action - `condition` - Condition One of `trigger`, `action`, `condition`.',
    },
    config: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Node-specific configuration and parameters',
    },
    is_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the rule is switched on.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `config`, `created_at`, `created_by_id`, `handler_name`, `id`, `is_enabled`, `last_triggered_at`, `name`, `next_scheduled_at`, `node_type`, `updated_at`, `version_id`.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/automations/${safeUrlPathSegment(params.automation_id, 'automation_id')}/nodes/`,
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
          handler_name: { key: 'handler_name', type: 'string', required: true },
          name: { key: 'name', type: 'string', required: true },
          node_type: { key: 'node_type', type: 'string', required: true },
          config: { key: 'config', type: 'string', required: false },
          is_enabled: { key: 'is_enabled', type: 'boolean', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2ProjectAutomationsbfbfc7Schema),
  outputs: { result: PLANEV2PROJECTAUTOMATIONSBFBFC7_OUTPUT },
}
