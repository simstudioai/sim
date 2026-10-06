import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneGetWorkItemByIdentifierParams, PlaneWorkItemResponse } from '@/tools/plane/types'
import {
  mapPlaneWorkItem,
  PLANE_CONNECTION_PARAMS,
  PLANE_WORK_ITEM_PROPERTIES,
  planeHeaders,
  planeWorkspaceUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

const IDENTIFIER_PATTERN = /^([A-Za-z0-9]+)-(\d+)$/

export const planeGetWorkItemByIdentifierTool: ToolConfig<
  PlaneGetWorkItemByIdentifierParams,
  PlaneWorkItemResponse
> = {
  id: 'plane_get_work_item_by_identifier',
  name: 'Plane Get Work Item by Identifier',
  description: 'Get a Plane work item by its human-readable identifier (e.g., PROJ-123)',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    identifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Work item identifier: project identifier and sequence number (e.g., PROJ-123)',
    },
  },

  request: {
    url: (params) => {
      const match = params.identifier.trim().match(IDENTIFIER_PATTERN)
      if (!match) {
        throw new Error('Identifier must look like PROJ-123 (project identifier, dash, number)')
      }
      return planeWorkspaceUrl(
        params,
        `work-items/${encodeURIComponent(match[1].toUpperCase())}-${match[2]}/`
      )
    },
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return { success: true, output: { workItem: mapPlaneWorkItem(data) } }
  },

  outputs: {
    workItem: {
      type: 'object',
      description: 'The work item',
      properties: PLANE_WORK_ITEM_PROPERTIES,
    },
  },
}
