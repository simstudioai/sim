import { PLANEUPDATEPROJECTMAPPINGBYKEYRESULT5729C9_OUTPUT } from '@/tools/plane/outputs'
import { planeUpdateProjectMappingByKeyResult5729c9Schema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateProjectMappingByKeyParams,
  PlaneUpdateProjectMappingByKeyResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  planeApiUrl,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeUpdateProjectMappingByKeyTool: ToolConfig<
  PlaneUpdateProjectMappingByKeyParams,
  PlaneUpdateProjectMappingByKeyResponse
> = {
  id: 'plane_update_project_mapping_by_key',
  name: 'Plane v1 only: Update project group mapping by key',
  description: 'v1 only: Update project group mapping by key in Plane. Requires API v1.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
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
    project_key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The project identifier (e.g. `ENG`). Case-insensitive — the value is matched against the uppercase project identifier.',
    },
    idp_group_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the IdP group the mapping belongs to. Matched exactly.',
    },
    new_idp_group_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The name of the IdP group to map.',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Project role slug to assign to members of the IdP group (e.g. `member`, `admin`, `guest`).',
    },
    project: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Project identifier to map the group to (e.g. `ENG`). Mutually exclusive with `all_projects`.',
    },
    all_projects: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'When `true`, maps the group to all projects in the workspace. Mutually exclusive with `project`.',
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/group-sync/project-mappings/${safeUrlPathSegment(params.project_key, 'project_key')}/${safeUrlPathSegment(params.idp_group_name, 'idp_group_name')}/`
      )
    },
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          idp_group_name: { key: 'new_idp_group_name', type: 'string', required: false },
          role: { key: 'role', type: 'string', required: false },
          project: { key: 'project', type: 'string', required: false },
          all_projects: { key: 'all_projects', type: 'boolean', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeUpdateProjectMappingByKeyResult5729c9Schema),
  outputs: { result: PLANEUPDATEPROJECTMAPPINGBYKEYRESULT5729C9_OUTPUT },
}
