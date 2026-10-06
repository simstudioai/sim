import { toArray } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PlaneListWorkspaceMembersParams,
  PlaneWorkspaceMemberListResponse,
} from '@/tools/plane/types'
import {
  mapPlaneWorkspaceMember,
  PLANE_CONNECTION_PARAMS,
  PLANE_WORKSPACE_MEMBER_PROPERTIES,
  planeHeaders,
  planeWorkspaceUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeListWorkspaceMembersTool: ToolConfig<
  PlaneListWorkspaceMembersParams,
  PlaneWorkspaceMemberListResponse
> = {
  id: 'plane_list_workspace_members',
  name: 'Plane List Workspace Members',
  description: 'List the members of a Plane workspace with their roles',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
  },

  request: {
    url: (params) => planeWorkspaceUrl(params, 'members/'),
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return { success: true, output: { members: toArray(data).map(mapPlaneWorkspaceMember) } }
  },

  outputs: {
    members: {
      type: 'array',
      description: 'Workspace members',
      items: { type: 'object', properties: PLANE_WORKSPACE_MEMBER_PROPERTIES },
    },
  },
}
