import { PLANEV2WORKSPACEWORKITEMPROPERTYOPTIONS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkspaceWorkItemPropertyOptionsSchema } from '@/tools/plane/schemas'
import type {
  PlaneCreateWorkspacePropertyOptionParams,
  PlaneCreateWorkspacePropertyOptionResponse,
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

export const planeCreateWorkspacePropertyOptionTool: ToolConfig<
  PlaneCreateWorkspacePropertyOptionParams,
  PlaneCreateWorkspacePropertyOptionResponse
> = {
  id: 'plane_create_workspace_property_option',
  name: 'Plane Create a workspace property option',
  description: 'Create a workspace property option in Plane. Requires API v2.',
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
    property_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The workspace-level `OPTION` property to add the choice to. A project-scoped property id is a `404` here — this path never crosses into a project. See [Workspace work item properties](/api-reference/v2/workspace-work-item-properties/overview).',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The choice as it is displayed. Maximum 255 characters.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form text explaining when to pick this choice.',
    },
    is_default: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Make this the property's default choice. At most one option per property can be the default, and there is no automatic hand-off: if another option already has it, this request is rejected with `400 invalid_request`. Clear the current default with a `PATCH` first.",
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this option, for sync and import correlation. Maximum 255 characters.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The system `external_id` came from, for example `github` or `jira`. Maximum 255 characters.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/options/`
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
          is_default: { key: 'is_default', type: 'boolean', required: false },
          external_id: { key: 'external_id', type: 'string', required: false },
          external_source: { key: 'external_source', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2WorkspaceWorkItemPropertyOptionsSchema),
  outputs: { result: PLANEV2WORKSPACEWORKITEMPROPERTYOPTIONS_OUTPUT },
}
