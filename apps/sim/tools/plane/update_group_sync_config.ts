import { PLANEV2GROUPSYNC460C90_OUTPUT } from '@/tools/plane/outputs'
import { planeV2GroupSync460c90Schema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateGroupSyncConfigParams,
  PlaneUpdateGroupSyncConfigResponse,
} from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
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

export const planeUpdateGroupSyncConfigTool: ToolConfig<
  PlaneUpdateGroupSyncConfigParams,
  PlaneUpdateGroupSyncConfigResponse
> = {
  id: 'plane_update_group_sync_config',
  name: 'Plane Update the group sync configuration',
  description: 'Update the group sync configuration in Plane. Supports API v1 compatibility.',
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
    auto_remove: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether auto remove.',
    },
    default_workspace_role_slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The default workspace role slug. Nullable.',
    },
    group_attribute_key: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The group attribute key. Maximum 255 characters.',
    },
    is_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the rule is switched on.',
    },
    sync_offline: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether sync offline.',
    },
    sync_on_login: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether sync on login.',
    },
    default_workspace_role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. Role slug assigned to users when added to the workspace via group sync.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? [
              'workspace_slug',
              'is_enabled',
              'sync_on_login',
              'auto_remove',
              'sync_offline',
              'group_attribute_key',
              'default_workspace_role',
            ]
          : [
              'workspace_slug',
              'auto_remove',
              'default_workspace_role_slug',
              'group_attribute_key',
              'is_enabled',
              'sync_offline',
              'sync_on_login',
            ],
        [
          'workspace_slug',
          'auto_remove',
          'default_workspace_role_slug',
          'group_attribute_key',
          'is_enabled',
          'sync_offline',
          'sync_on_login',
          'default_workspace_role',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/group-sync/config/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/group-sync/config/`
          )
    },
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            {
              is_enabled: { key: 'is_enabled', type: 'boolean', required: false },
              sync_on_login: { key: 'sync_on_login', type: 'boolean', required: false },
              auto_remove: { key: 'auto_remove', type: 'boolean', required: false },
              sync_offline: { key: 'sync_offline', type: 'boolean', required: false },
              group_attribute_key: { key: 'group_attribute_key', type: 'string', required: false },
              default_workspace_role: {
                key: 'default_workspace_role',
                type: 'string',
                required: false,
              },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              auto_remove: { key: 'auto_remove', type: 'boolean', required: false },
              default_workspace_role_slug: {
                key: 'default_workspace_role_slug',
                type: 'string',
                required: false,
              },
              group_attribute_key: { key: 'group_attribute_key', type: 'string', required: false },
              is_enabled: { key: 'is_enabled', type: 'boolean', required: false },
              sync_offline: { key: 'sync_offline', type: 'boolean', required: false },
              sync_on_login: { key: 'sync_on_login', type: 'boolean', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2GroupSync460c90Schema)
      : planeObjectResponse(response, planeV2GroupSync460c90Schema),
  outputs: { result: PLANEV2GROUPSYNC460C90_OUTPUT },
}
