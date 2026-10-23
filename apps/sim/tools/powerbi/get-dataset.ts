import {
  POWERBI_DATASET_OUTPUT_PROPERTIES,
  type PowerBIDatasetParams,
  type PowerBIGetDatasetResponse,
} from '@/tools/powerbi/types'
import {
  POWERBI_ACCESS_TOKEN_PARAM,
  POWERBI_DATASET_ID_PARAM,
  POWERBI_GROUP_ID_PARAM,
  powerBIHeaders,
  powerBIUrl,
  projectPowerBIDataset,
  readPowerBIJson,
} from '@/tools/powerbi/utils'
import type { ToolConfig } from '@/tools/types'

export const powerbiGetDatasetTool: ToolConfig<PowerBIDatasetParams, PowerBIGetDatasetResponse> = {
  id: 'powerbi_get_dataset',
  name: 'Power BI Get Semantic Model',
  description: 'Get semantic model metadata from a Power BI workspace.',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',
  oauth: { required: true, provider: 'microsoft-powerbi' },
  params: {
    accessToken: POWERBI_ACCESS_TOKEN_PARAM,
    groupId: POWERBI_GROUP_ID_PARAM,
    datasetId: POWERBI_DATASET_ID_PARAM,
  },
  request: {
    url: (params) => powerBIUrl(['groups', params.groupId, 'datasets', params.datasetId]),
    method: 'GET',
    headers: (params) => powerBIHeaders(params.accessToken),
  },
  transformResponse: async (response, _params, context) => ({
    success: true,
    output: { dataset: projectPowerBIDataset(await readPowerBIJson(response, context?.signal)) },
  }),
  outputs: {
    dataset: {
      type: 'object',
      description: 'Semantic model metadata; unavailable fields are null',
      properties: POWERBI_DATASET_OUTPUT_PROPERTIES,
    },
  },
}
