import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, MONACO_LIST_PARAMS } from '@/tools/monaco/params'
import {
  MONACO_CAMPAIGN_OUTPUT_PROPERTIES,
  MONACO_PAGINATION_OUTPUT,
  type MonacoListCampaignsResponse,
  type MonacoListParams,
} from '@/tools/monaco/types'
import {
  buildMonacoListBody,
  MONACO_API_BASE,
  mapMonacoCampaign,
  mapMonacoPagination,
  monacoHeaders,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoListCampaignsTool: ToolConfig<MonacoListParams, MonacoListCampaignsResponse> = {
  id: 'monaco_list_campaigns',
  name: 'Monaco List Campaigns',
  description: 'List Monaco campaigns with optional filters, sorting, and pagination.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    ...MONACO_LIST_PARAMS,
  },

  request: {
    url: `${MONACO_API_BASE}/v1/campaigns/list`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => buildMonacoListBody(params),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        campaigns: toArray(data.data).map(mapMonacoCampaign),
        pagination: mapMonacoPagination(data.pagination),
      },
    }
  },

  outputs: {
    campaigns: {
      type: 'array',
      description: 'Campaigns on this page',
      items: { type: 'object', properties: MONACO_CAMPAIGN_OUTPUT_PROPERTIES },
    },
    pagination: MONACO_PAGINATION_OUTPUT,
  },
}
