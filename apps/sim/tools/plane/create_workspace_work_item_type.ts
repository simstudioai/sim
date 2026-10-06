import { PLANEV2WORKSPACEWORKITEMTYPES_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkspaceWorkItemTypesSchema } from '@/tools/plane/schemas'
import type {
  PlaneCreateWorkspaceWorkItemTypeParams,
  PlaneCreateWorkspaceWorkItemTypeResponse,
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

export const planeCreateWorkspaceWorkItemTypeTool: ToolConfig<
  PlaneCreateWorkspaceWorkItemTypeParams,
  PlaneCreateWorkspaceWorkItemTypeResponse
> = {
  id: 'plane_create_workspace_work_item_type',
  name: 'Plane Create a workspace work item type',
  description: 'Create a workspace work item type in Plane. Requires API v2.',
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
      description:
        'Display name for the type, for example `Incident`. Maximum 255 characters. Reusing a name that already exists in the workspace returns `409`.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'What this type is for. It is shown next to the type wherever someone picks it, so write it for the person choosing.',
    },
    is_active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the type can be selected. Send `false` to create a type that exists but stays out of pickers until you are ready to roll it out.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this type, for sync and import correlation. Maximum 255 characters, and accepts `null`. Write-only — it is not returned on read, so keep your own mapping to the Plane `id`.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The system `external_id` came from, for example `jira`. Maximum 255 characters, and accepts `null`. Write-only, like `external_id` — an `external_id` is only unique within its source, so record both.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `created_at`, `description`, `id`, `is_active`, `is_default`, `is_epic`, `level`, `logo_props`, `name`. See [Sparse fields](/api-reference/v2/sparse-fields).',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/work-item-types/`,
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
          external_id: { key: 'external_id', type: 'string', required: false },
          external_source: { key: 'external_source', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2WorkspaceWorkItemTypesSchema),
  outputs: { result: PLANEV2WORKSPACEWORKITEMTYPES_OUTPUT },
}
