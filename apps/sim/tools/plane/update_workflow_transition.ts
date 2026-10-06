import { PLANEV2WORKFLOWTRANSITIONS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkflowTransitionsSchema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateWorkflowTransitionParams,
  PlaneUpdateWorkflowTransitionResponse,
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

export const planeUpdateWorkflowTransitionTool: ToolConfig<
  PlaneUpdateWorkflowTransitionParams,
  PlaneUpdateWorkflowTransitionResponse
> = {
  id: 'plane_update_workflow_transition',
  name: 'Plane Update a workflow transition',
  description: 'Update a workflow transition in Plane. Requires API v2.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The workflow transition id.',
    },
    member_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ids of the members to associate. Replaces the current set.',
    },
    rejection_state_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related rejection state. Nullable.',
    },
    required_approvals: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'How many approvals a transition needs before it may run. Nullable.',
    },
    state_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related state.',
    },
    transition_state_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related transition state. Nullable.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `id`, `member_ids`, `rejection_state_id`, `required_approvals`, `transition_state_id`, `workflow_state_id`.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/workflows/${safeUrlPathSegment(params.workflow_id, 'workflow_id')}/state-transitions/${safeUrlPathSegment(params.pk, 'pk')}/`,
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
          member_ids: { key: 'member_ids', type: 'array', required: false },
          rejection_state_id: { key: 'rejection_state_id', type: 'string', required: false },
          required_approvals: { key: 'required_approvals', type: 'integer', required: false },
          state_id: { key: 'state_id', type: 'string', required: false },
          transition_state_id: { key: 'transition_state_id', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2WorkflowTransitionsSchema),
  outputs: { result: PLANEV2WORKFLOWTRANSITIONS_OUTPUT },
}
