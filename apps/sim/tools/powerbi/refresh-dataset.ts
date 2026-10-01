import type {
  PowerBIRefreshDatasetParams,
  PowerBIRefreshDatasetResponse,
} from '@/tools/powerbi/types'
import {
  POWERBI_ACCESS_TOKEN_PARAM,
  POWERBI_DATASET_ID_PARAM,
  POWERBI_GROUP_ID_PARAM,
  powerBIHeaders,
  powerBIUrl,
} from '@/tools/powerbi/utils'
import type { ToolConfig } from '@/tools/types'

export const powerbiRefreshDatasetTool: ToolConfig<
  PowerBIRefreshDatasetParams,
  PowerBIRefreshDatasetResponse
> = {
  id: 'powerbi_refresh_dataset',
  name: 'Power BI Refresh Semantic Model',
  description:
    'Request a standard asynchronous semantic model refresh and return acceptance immediately. Acceptance does not mean completion; use Get Refresh History separately to inspect status. Shared capacity allows eight refresh requests per day, including scheduled refreshes.',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',
  oauth: { required: true, provider: 'microsoft-powerbi' },
  params: {
    accessToken: POWERBI_ACCESS_TOKEN_PARAM,
    groupId: POWERBI_GROUP_ID_PARAM,
    datasetId: POWERBI_DATASET_ID_PARAM,
    notifyOption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      default: 'NoNotification',
      description: 'NoNotification, MailOnFailure, or MailOnCompletion; defaults to NoNotification',
    },
  },
  request: {
    url: (params) =>
      powerBIUrl(['groups', params.groupId, 'datasets', params.datasetId, 'refreshes']),
    method: 'POST',
    headers: (params) => powerBIHeaders(params.accessToken),
    body: (params) => {
      const notifyOption = params.notifyOption ?? 'NoNotification'
      if (!['NoNotification', 'MailOnFailure', 'MailOnCompletion'].includes(notifyOption)) {
        throw new Error('notifyOption must be NoNotification, MailOnFailure, or MailOnCompletion')
      }
      return { notifyOption }
    },
    retry: { enabled: false },
  },
  transformResponse: async (response) => {
    if (response.status !== 202)
      throw new Error(`Power BI did not accept the refresh request (HTTP ${response.status})`)
    return {
      success: true,
      output: {
        accepted: true,
        requestId: response.headers.get('x-ms-request-id') ?? null,
        location: response.headers.get('location') ?? null,
      },
    }
  },
  outputs: {
    accepted: {
      type: 'boolean',
      description: 'Whether Power BI accepted the refresh request; does not indicate completion',
    },
    requestId: {
      type: 'string',
      nullable: true,
      description: 'Provider x-ms-request-id header, when supplied',
    },
    location: {
      type: 'string',
      nullable: true,
      description: 'Provider Location header, when supplied',
    },
  },
}
