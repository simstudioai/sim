import { filterUndefined } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneCreateProjectParams, PlaneProjectResponse } from '@/tools/plane/types'
import {
  mapPlaneProject,
  optionalTrimmed,
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_PROPERTIES,
  planeHeaders,
  planeWorkspaceUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeCreateProjectTool: ToolConfig<PlaneCreateProjectParams, PlaneProjectResponse> = {
  id: 'plane_create_project',
  name: 'Plane Create Project',
  description:
    'Create a project in a Plane workspace with the default workflow states. You become its admin',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project name (unique within the workspace)',
    },
    identifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Short uppercase identifier used as the work item prefix (e.g., "ENG" for ENG-42). Max 12 characters, unique within the workspace',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project description',
    },
    projectLeadId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID (UUID) of the project lead; must be a workspace member',
    },
    defaultAssigneeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID (UUID) assigned to new work items by default',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'IANA timezone for cycles and dates (e.g., "America/New_York"). Defaults to UTC',
    },
  },

  request: {
    url: (params) => planeWorkspaceUrl(params, 'projects/'),
    method: 'POST',
    headers: planeHeaders,
    body: (params) =>
      filterUndefined({
        name: params.name.trim(),
        identifier: params.identifier.trim().toUpperCase(),
        description: optionalTrimmed(params.description),
        project_lead: optionalTrimmed(params.projectLeadId),
        default_assignee: optionalTrimmed(params.defaultAssigneeId),
        timezone: optionalTrimmed(params.timezone),
      }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return { success: true, output: { project: mapPlaneProject(data) } }
  },

  outputs: {
    project: {
      type: 'object',
      description: 'The created project',
      properties: PLANE_PROJECT_PROPERTIES,
    },
  },
}
