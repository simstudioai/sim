import {
  POWERBI_REFRESH_OUTPUT_PROPERTIES,
  type PowerBIGetRefreshHistoryParams,
  type PowerBIGetRefreshHistoryResponse,
} from '@/tools/powerbi/types'
import {
  POWERBI_ACCESS_TOKEN_PARAM,
  POWERBI_DATASET_ID_PARAM,
  POWERBI_GROUP_ID_PARAM,
  powerBICollection,
  powerBIHeaders,
  powerBIInteger,
  powerBIUrl,
  projectPowerBIRefresh,
  readPowerBIJson,
} from '@/tools/powerbi/utils'
import type { ToolConfig } from '@/tools/types'

export const powerbiGetRefreshHistoryTool: ToolConfig<
  PowerBIGetRefreshHistoryParams,
  PowerBIGetRefreshHistoryResponse
> = {
  id: 'powerbi_get_refresh_history',
  name: 'Power BI Get Refresh History',
  description:
    'Get recent semantic model refresh history; requires Write permission on the model. Unknown can mean a refresh is in progress or its completion state is unknown.',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',
  oauth: { required: true, provider: 'microsoft-powerbi' },
  params: {
    accessToken: POWERBI_ACCESS_TOKEN_PARAM,
    groupId: POWERBI_GROUP_ID_PARAM,
    datasetId: POWERBI_DATASET_ID_PARAM,
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Requested number of entries; defaults to the last available 60',
    },
  },
  request: {
    url: (params) =>
      powerBIUrl(['groups', params.groupId, 'datasets', params.datasetId, 'refreshes'], {
        $top: powerBIInteger(params.top, 'top', 1),
      }),
    method: 'GET',
    headers: (params) => powerBIHeaders(params.accessToken),
  },
  transformResponse: async (response, _params, context) => {
    const refreshes = powerBICollection(await readPowerBIJson(response, context?.signal)).map(
      projectPowerBIRefresh
    )
    return { success: true, output: { refreshes, refreshCount: refreshes.length } }
  },
  outputs: {
    refreshes: {
      type: 'array',
      description: 'Recent refresh entries returned by Power BI',
      items: { type: 'object', properties: POWERBI_REFRESH_OUTPUT_PROPERTIES },
    },
    refreshCount: { type: 'number', description: 'Number of refresh entries returned' },
  },
}
