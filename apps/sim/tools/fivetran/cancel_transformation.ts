import {
  type FivetranMessageResponse,
  type FivetranTransformationParams,
  MESSAGE_OUTPUTS,
} from '@/tools/fivetran/types'
import {
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  FIVETRAN_TRANSFORMATION_ID_PARAM,
  fivetranHeaders,
  fivetranId,
  fivetranUrl,
  transformMessageResponse,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranCancelTransformationTool: ToolConfig<
  FivetranTransformationParams,
  FivetranMessageResponse
> = {
  id: 'fivetran_cancel_transformation',
  name: 'Fivetran Cancel Transformation',
  description: 'Cancel a running Fivetran transformation.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_TRANSFORMATION_ID_PARAM,
  },

  request: {
    url: (params) =>
      fivetranUrl(
        `/transformations/${fivetranId(params.transformationId, 'transformationId')}/cancel`
      ),
    method: 'POST',
    headers: (params) => fivetranHeaders(params),
    body: () => ({}),
  },

  transformResponse: transformMessageResponse,

  outputs: { ...MESSAGE_OUTPUTS },
}
