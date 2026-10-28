import { filterUndefined } from '@sim/utils/object'
import {
  type FivetranMessageResponse,
  type FivetranRunTransformationParams,
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
  optionalBoolean,
  transformMessageResponse,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranRunTransformationTool: ToolConfig<
  FivetranRunTransformationParams,
  FivetranMessageResponse
> = {
  id: 'fivetran_run_transformation',
  name: 'Fivetran Run Transformation',
  description: 'Start a run of a Fivetran transformation now.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_TRANSFORMATION_ID_PARAM,
    fullRefresh: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rebuild incremental models from scratch (dbt --full-refresh)',
    },
  },

  request: {
    url: (params) =>
      fivetranUrl(
        `/transformations/${fivetranId(params.transformationId, 'transformationId')}/run`
      ),
    method: 'POST',
    headers: (params) => fivetranHeaders(params),
    body: (params) => filterUndefined({ full_refresh: optionalBoolean(params.fullRefresh) }),
  },

  transformResponse: transformMessageResponse,

  outputs: { ...MESSAGE_OUTPUTS },
}
