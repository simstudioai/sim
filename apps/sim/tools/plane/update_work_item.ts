import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneUpdateWorkItemParams, PlaneWorkItemResponse } from '@/tools/plane/types'
import {
  mapPlaneWorkItem,
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_ID_PARAM,
  PLANE_WORK_ITEM_PROPERTIES,
  planeHeaders,
  planePathSegment,
  planeProjectUrl,
} from '@/tools/plane/utils'
import {
  buildPlaneWorkItemBody,
  PLANE_WORK_ITEM_FIELD_PARAMS,
} from '@/tools/plane/work_item_shared'
import type { ToolConfig } from '@/tools/types'

export const planeUpdateWorkItemTool: ToolConfig<PlaneUpdateWorkItemParams, PlaneWorkItemResponse> =
  {
    id: 'plane_update_work_item',
    name: 'Plane Update Work Item',
    description:
      'Update fields on a Plane work item. Only the fields you provide are changed; assignees and labels are replaced when provided',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.PLANE_ERRORS,

    params: {
      ...PLANE_CONNECTION_PARAMS,
      ...PLANE_PROJECT_ID_PARAM,
      ...PLANE_WORK_ITEM_ID_PARAM,
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New work item title',
      },
      ...PLANE_WORK_ITEM_FIELD_PARAMS,
    },

    request: {
      url: (params) =>
        planeProjectUrl(params, `work-items/${planePathSegment(params.workItemId)}/`),
      method: 'PATCH',
      headers: planeHeaders,
      body: (params) => {
        const body = buildPlaneWorkItemBody(params)
        if (Object.keys(body).length === 0) {
          throw new Error('Provide at least one field to update')
        }
        return body
      },
    },

    transformResponse: async (response) => {
      const data = await response.json()
      return { success: true, output: { workItem: mapPlaneWorkItem(data) } }
    },

    outputs: {
      workItem: {
        type: 'object',
        description: 'The updated work item',
        properties: PLANE_WORK_ITEM_PROPERTIES,
      },
    },
  }
