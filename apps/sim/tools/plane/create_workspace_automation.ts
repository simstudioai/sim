import { PLANEV2WORKSPACEAUTOMATIONS86A400_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkspaceAutomations86a400Schema } from '@/tools/plane/schemas'
import type {
  PlaneCreateWorkspaceAutomationParams,
  PlaneCreateWorkspaceAutomationResponse,
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

export const planeCreateWorkspaceAutomationTool: ToolConfig<
  PlaneCreateWorkspaceAutomationParams,
  PlaneCreateWorkspaceAutomationResponse
> = {
  id: 'plane_create_workspace_automation',
  name: 'Plane Create a workspace workspace automation',
  description: 'Create a workspace workspace automation in Plane. Requires API v2.',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Human-readable automation name Maximum 255 characters.',
    },
    scope: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The scope defines on what entity this automation runs on (e.g., WorkItem, Cycle, Module) Maximum 50 characters.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Automation description',
    },
    project_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ids of the projects to associate. Replaces the current set.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `bot_user_id`, `created_at`, `created_by_id`, `current_version_id`, `description`, `id`, `is_enabled`, `is_global`, `last_run_at`, `name`, `project_ids`, `run_count`, `scope`, `status`, `updated_at`.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/automations/`,
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
          name: { key: 'name', type: 'string', required: true },
          scope: { key: 'scope', type: 'string', required: true },
          description: { key: 'description', type: 'string', required: false },
          project_ids: { key: 'project_ids', type: 'array', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2WorkspaceAutomations86a400Schema),
  outputs: { result: PLANEV2WORKSPACEAUTOMATIONS86A400_OUTPUT },
}
