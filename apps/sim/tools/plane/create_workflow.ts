import { PLANEV2WORKFLOWS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkflowsSchema } from '@/tools/plane/schemas'
import type { PlaneCreateWorkflowParams, PlaneCreateWorkflowResponse } from '@/tools/plane/types'
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

export const planeCreateWorkflowTool: ToolConfig<
  PlaneCreateWorkflowParams,
  PlaneCreateWorkflowResponse
> = {
  id: 'plane_create_workflow',
  name: 'Plane Create a workflow',
  description: 'Create a workflow in Plane. Requires API v2.',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name. Maximum 255 characters.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form description. Nullable.',
    },
    is_active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the record is active.',
    },
    work_item_type_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ids of the work item types to associate. Replaces the current set.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `description`, `id`, `is_active`, `is_default`, `name`, `work_item_type_ids`.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/workflows/`,
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
          description: { key: 'description', type: 'string', required: false },
          is_active: { key: 'is_active', type: 'boolean', required: false },
          work_item_type_ids: { key: 'work_item_type_ids', type: 'array', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) => planeObjectResponse(response, planeV2WorkflowsSchema),
  outputs: { result: PLANEV2WORKFLOWS_OUTPUT },
}
