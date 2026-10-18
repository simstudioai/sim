import type { GreenhouseGetJobV2Params, GreenhouseGetJobV2Response } from '@/tools/greenhouse/types'
import { JOBS_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  mapGreenhouseFields,
  readGreenhouseSingle,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseGetJobV2Tool: ToolConfig<
  GreenhouseGetJobV2Params,
  GreenhouseGetJobV2Response
> = {
  id: 'greenhouse_get_job_v2',
  name: 'Greenhouse Get Job',
  description: 'Retrieves one job by ID using the v3 list endpoint.',
  version: '2.0.0',
  oauth: { required: true, provider: 'greenhouse' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Greenhouse OAuth access token',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Greenhouse resource ID',
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl(
        'jobs',
        { ids: String(params.id), per_page: 1 },
        {
          ids: { type: 'csv', integerItems: true, maxItems: 1, required: true },
          per_page: { type: 'integer', minimum: 1, maximum: 500 },
        }
      ),
    method: 'GET',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => ({
    success: true,
    output: mapGreenhouseFields(await readGreenhouseSingle(response), JOBS_V2_OUTPUTS),
  }),
  outputs: { ...JOBS_V2_OUTPUTS },
}
