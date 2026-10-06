import { PLANEV2WORKSPACEWORKITEMPROPERTYOPTIONS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkspaceWorkItemPropertyOptionsSchema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateWorkspacePropertyOptionParams,
  PlaneUpdateWorkspacePropertyOptionResponse,
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

export const planeUpdateWorkspacePropertyOptionTool: ToolConfig<
  PlaneUpdateWorkspacePropertyOptionParams,
  PlaneUpdateWorkspacePropertyOptionResponse
> = {
  id: 'plane_update_workspace_property_option',
  name: 'Plane Update a workspace property option',
  description: 'Update a workspace property option in Plane. Requires API v2.',
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
        'The workspace-level property the option belongs to. See [Workspace work item properties](/api-reference/v2/workspace-work-item-properties/overview).',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The option to update. It is looked up within the property, so an option id under the wrong `property_id` is a `404`.',
    },
    name: {
      type: 'string',
      required: false,
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
        "Make this the property's default choice, or send `false` to clear it. At most one option per property can be the default: setting it while a different option already holds it returns `400 invalid_request`, so clear the current default first and then set the new one.",
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
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/options/${safeUrlPathSegment(params.pk, 'pk')}/`
      )
    },
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          name: { key: 'name', type: 'string', required: false },
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
