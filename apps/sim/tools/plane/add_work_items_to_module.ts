import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PlaneAddWorkItemsResponse,
  PlaneAddWorkItemsToModuleParams,
} from '@/tools/plane/types'
import {
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  parsePlaneIdList,
  planeHeaders,
  planePathSegment,
  planeProjectUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeAddWorkItemsToModuleTool: ToolConfig<
  PlaneAddWorkItemsToModuleParams,
  PlaneAddWorkItemsResponse
> = {
  id: 'plane_add_work_items_to_module',
  name: 'Plane Add Work Items to Module',
  description: 'Add work items to a Plane module',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    moduleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Module ID (UUID).',
    },
    workItemIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Work item IDs (UUIDs) to add',
      items: { type: 'string', description: 'Work item ID (UUID)' },
    },
  },

  request: {
    url: (params) =>
      planeProjectUrl(
        params,
        `modules/${planePathSegment(params.moduleId, 'moduleId')}/module-issues/`
      ),
    method: 'POST',
    headers: planeHeaders,
    body: (params) => {
      const issues = parsePlaneIdList(params.workItemIds) ?? []
      if (issues.length === 0) throw new Error('Provide at least one work item ID')
      return { issues }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const ids = toArray(data)
      .map((entry) => toRecord(entry).issue)
      .filter((id): id is string => typeof id === 'string')
    return { success: true, output: { workItemIds: [...new Set(ids)] } }
  },

  outputs: {
    workItemIds: {
      type: 'array',
      description: 'IDs of all work items now in the module, including ones added earlier',
      items: { type: 'string', description: 'Work item ID (UUID)' },
    },
  },
}
