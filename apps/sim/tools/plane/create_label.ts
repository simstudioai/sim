import { filterUndefined } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneCreateLabelParams, PlaneLabelResponse } from '@/tools/plane/types'
import {
  mapPlaneLabel,
  optionalTrimmed,
  PLANE_CONNECTION_PARAMS,
  PLANE_LABEL_PROPERTIES,
  PLANE_PROJECT_ID_PARAM,
  planeHeaders,
  planeProjectUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeCreateLabelTool: ToolConfig<PlaneCreateLabelParams, PlaneLabelResponse> = {
  id: 'plane_create_label',
  name: 'Plane Create Label',
  description: 'Create a label in a Plane project',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Label name (unique within the project)',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Label color as a hex code (e.g., "#EF4444")',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Label description',
    },
    parentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent label ID (UUID) to group this label under',
    },
  },

  request: {
    url: (params) => planeProjectUrl(params, 'labels/'),
    method: 'POST',
    headers: planeHeaders,
    body: (params) =>
      filterUndefined({
        name: params.name.trim(),
        color: optionalTrimmed(params.color),
        description: optionalTrimmed(params.description),
        parent: optionalTrimmed(params.parentId),
      }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return { success: true, output: { label: mapPlaneLabel(data) } }
  },

  outputs: {
    label: { type: 'object', description: 'The created label', properties: PLANE_LABEL_PROPERTIES },
  },
}
