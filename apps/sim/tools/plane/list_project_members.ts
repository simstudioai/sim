import { toArray } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PlaneListProjectMembersParams,
  PlaneProjectMemberListResponse,
} from '@/tools/plane/types'
import {
  mapPlaneUser,
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_USER_PROPERTIES,
  planeHeaders,
  planeProjectUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeListProjectMembersTool: ToolConfig<
  PlaneListProjectMembersParams,
  PlaneProjectMemberListResponse
> = {
  id: 'plane_list_project_members',
  name: 'Plane List Project Members',
  description: 'List the members of a Plane project (the users that work items can be assigned to)',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
  },

  request: {
    url: (params) => planeProjectUrl(params, 'members/'),
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return { success: true, output: { members: toArray(data).flat().map(mapPlaneUser) } }
  },

  outputs: {
    members: {
      type: 'array',
      description: 'Project members',
      items: { type: 'object', properties: PLANE_USER_PROPERTIES },
    },
  },
}
