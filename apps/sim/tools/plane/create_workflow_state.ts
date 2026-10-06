import { PLANEV2WORKFLOWSTATES_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkflowStatesSchema } from '@/tools/plane/schemas'
import type {
  PlaneCreateWorkflowStateParams,
  PlaneCreateWorkflowStateResponse,
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

export const planeCreateWorkflowStateTool: ToolConfig<
  PlaneCreateWorkflowStateParams,
  PlaneCreateWorkflowStateResponse
> = {
  id: 'plane_create_workflow_state',
  name: 'Plane Create a workflow state',
  description: 'Create a workflow state in Plane. Requires API v2.',
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
    workflow_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The workflow the resource belongs to.',
    },
    allow_issue_creation: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether allow issue creation.',
    },
    is_default: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Make this the default for its parent. Setting it clears the flag on the previous default.',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The type. Maximum 255 characters.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `allow_issue_creation`, `created_at`, `created_by_id`, `id`, `is_default`, `state_id`, `type`, `workflow_id`.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/workflows/${safeUrlPathSegment(params.workflow_id, 'workflow_id')}/states/`,
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
          allow_issue_creation: { key: 'allow_issue_creation', type: 'boolean', required: false },
          is_default: { key: 'is_default', type: 'boolean', required: false },
          type: { key: 'type', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) => planeObjectResponse(response, planeV2WorkflowStatesSchema),
  outputs: { result: PLANEV2WORKFLOWSTATES_OUTPUT },
}
