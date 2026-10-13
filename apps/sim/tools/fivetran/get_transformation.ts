import {
  type FivetranGetTransformationResponse,
  type FivetranTransformationParams,
  TRANSFORMATION_PROPERTIES,
} from '@/tools/fivetran/types'
import {
  envelopeData,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  FIVETRAN_TRANSFORMATION_ID_PARAM,
  fivetranHeaders,
  fivetranId,
  fivetranUrl,
  mapTransformation,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranGetTransformationTool: ToolConfig<
  FivetranTransformationParams,
  FivetranGetTransformationResponse
> = {
  id: 'fivetran_get_transformation',
  name: 'Fivetran Get Transformation',
  description: 'Get a Fivetran transformation with its status, schedule, and output models.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_TRANSFORMATION_ID_PARAM,
  },

  request: {
    url: (params) =>
      fivetranUrl(`/transformations/${fivetranId(params.transformationId, 'transformationId')}`),
    method: 'GET',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: async (response: Response) => {
    return {
      success: true,
      output: { transformation: mapTransformation(envelopeData(await response.json())) },
    }
  },

  outputs: {
    transformation: {
      type: 'object',
      description: 'The transformation',
      properties: TRANSFORMATION_PROPERTIES,
    },
  },
}
