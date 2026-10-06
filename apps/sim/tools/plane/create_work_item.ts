import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneCreateWorkItemParams, PlaneWorkItemResponse } from '@/tools/plane/types'
import {
  mapPlaneWorkItem,
  optionalTrimmed,
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_PROPERTIES,
  planeHeaders,
  planeProjectUrl,
} from '@/tools/plane/utils'
import {
  buildPlaneWorkItemBody,
  PLANE_WORK_ITEM_FIELD_PARAMS,
} from '@/tools/plane/work_item_shared'
import type { ToolConfig } from '@/tools/types'

export const planeCreateWorkItemTool: ToolConfig<PlaneCreateWorkItemParams, PlaneWorkItemResponse> =
  {
    id: 'plane_create_work_item',
    name: 'Plane Create Work Item',
    description: 'Create a work item (issue) in a Plane project',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.PLANE_ERRORS,

    params: {
      ...PLANE_CONNECTION_PARAMS,
      ...PLANE_PROJECT_ID_PARAM,
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Work item title',
      },
      ...PLANE_WORK_ITEM_FIELD_PARAMS,
      externalId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'ID of this item in an external system. With externalSource, Plane rejects duplicates (HTTP 409)',
      },
      externalSource: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Name of the external system (e.g., "github"), used with externalId',
      },
    },

    request: {
      url: (params) => planeProjectUrl(params, 'work-items/'),
      method: 'POST',
      headers: planeHeaders,
      body: (params) => {
        const body = buildPlaneWorkItemBody(params)
        const externalId = optionalTrimmed(params.externalId)
        const externalSource = optionalTrimmed(params.externalSource)
        if (externalId) body.external_id = externalId
        if (externalSource) body.external_source = externalSource
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
        description: 'The created work item',
        properties: PLANE_WORK_ITEM_PROPERTIES,
      },
    },
  }
