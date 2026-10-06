import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneGetProjectParams, PlaneProjectResponse } from '@/tools/plane/types'
import {
  mapPlaneProject,
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_PROJECT_PROPERTIES,
  planeHeaders,
  planePathSegment,
  planeWorkspaceUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeGetProjectTool: ToolConfig<PlaneGetProjectParams, PlaneProjectResponse> = {
  id: 'plane_get_project',
  name: 'Plane Get Project',
  description: 'Get a Plane project by its ID',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
  },

  request: {
    url: (params) => planeWorkspaceUrl(params, `projects/${planePathSegment(params.projectId)}/`),
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return { success: true, output: { project: mapPlaneProject(data) } }
  },

  outputs: {
    project: { type: 'object', description: 'The project', properties: PLANE_PROJECT_PROPERTIES },
  },
}
