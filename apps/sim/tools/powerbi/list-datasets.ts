import {
  POWERBI_DATASET_OUTPUT_PROPERTIES,
  type PowerBIGroupParams,
  type PowerBIListDatasetsResponse,
} from '@/tools/powerbi/types'
import {
  POWERBI_ACCESS_TOKEN_PARAM,
  POWERBI_GROUP_ID_PARAM,
  powerBICollection,
  powerBIHeaders,
  powerBIUrl,
  projectPowerBIDataset,
  readPowerBIJson,
} from '@/tools/powerbi/utils'
import type { ToolConfig } from '@/tools/types'

export const powerbiListDatasetsTool: ToolConfig<PowerBIGroupParams, PowerBIListDatasetsResponse> =
  {
    id: 'powerbi_list_datasets',
    name: 'Power BI List Semantic Models',
    description:
      'List semantic models in a Power BI workspace; available metadata depends on permissions.',
    version: '1.0.0',
    errorExtractor: 'nested-error-object',
    oauth: { required: true, provider: 'microsoft-powerbi' },
    params: { accessToken: POWERBI_ACCESS_TOKEN_PARAM, groupId: POWERBI_GROUP_ID_PARAM },
    request: {
      url: (params) => powerBIUrl(['groups', params.groupId, 'datasets']),
      method: 'GET',
      headers: (params) => powerBIHeaders(params.accessToken),
    },
    transformResponse: async (response, _params, context) => {
      const datasets = powerBICollection(await readPowerBIJson(response, context?.signal)).map(
        projectPowerBIDataset
      )
      return { success: true, output: { datasets, datasetCount: datasets.length } }
    },
    outputs: {
      datasets: {
        type: 'array',
        description: 'Semantic models in the workspace',
        items: { type: 'object', properties: POWERBI_DATASET_OUTPUT_PROPERTIES },
      },
      datasetCount: { type: 'number', description: 'Number of semantic models returned' },
    },
  }
