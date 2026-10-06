import { PLANEV2GROUPSYNC21AF09_OUTPUT } from '@/tools/plane/outputs'
import { planeV2GroupSync21af09Schema } from '@/tools/plane/schemas'
import type {
  PlaneCreateProjectMappingParams,
  PlaneCreateProjectMappingResponse,
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

export const planeCreateProjectMappingTool: ToolConfig<
  PlaneCreateProjectMappingParams,
  PlaneCreateProjectMappingResponse
> = {
  id: 'plane_create_project_mapping',
  name: 'Plane Create a project mapping',
  description: 'Create a project mapping in Plane. Supports API v1 compatibility.',
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
    idp_group_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The idp group name. Maximum 255 characters.',
    },
    role_slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The role slug.',
    },
    all_projects: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether all projects.',
    },
    project_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related project. Nullable.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `all_projects`, `created_at`, `id`, `idp_group_name`, `project_id`, `role_slug`.',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. Project role slug to assign to members of the IdP group (e.g. `member`, `admin`, `guest`).',
    },
    project: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. Project identifier to map the group to (e.g. `ENG`). Mutually exclusive with `all_projects`.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'idp_group_name', 'role', 'project', 'all_projects']
          : [
              'workspace_slug',
              'idp_group_name',
              'role_slug',
              'all_projects',
              'project_id',
              'fields',
            ],
        [
          'workspace_slug',
          'idp_group_name',
          'role_slug',
          'all_projects',
          'project_id',
          'fields',
          'role',
          'project',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/group-sync/project-mappings/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/group-sync/project-mappings/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
            })
          )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            {
              idp_group_name: { key: 'idp_group_name', type: 'string', required: true },
              role: { key: 'role', type: 'string', required: true },
              project: { key: 'project', type: 'string', required: false },
              all_projects: { key: 'all_projects', type: 'boolean', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              idp_group_name: { key: 'idp_group_name', type: 'string', required: true },
              role_slug: { key: 'role_slug', type: 'string', required: true },
              all_projects: { key: 'all_projects', type: 'boolean', required: false },
              project_id: { key: 'project_id', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2GroupSync21af09Schema)
      : planeObjectResponse(response, planeV2GroupSync21af09Schema),
  outputs: { result: PLANEV2GROUPSYNC21AF09_OUTPUT },
}
