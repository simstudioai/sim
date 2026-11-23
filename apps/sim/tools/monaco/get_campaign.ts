import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_CAMPAIGN_DETAIL_OUTPUT_PROPERTIES,
  type MonacoCampaignDetailResponse,
  type MonacoGetCampaignParams,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoCampaignDetail, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoGetCampaignTool: ToolConfig<
  MonacoGetCampaignParams,
  MonacoCampaignDetailResponse
> = {
  id: 'monaco_get_campaign',
  name: 'Monaco Get Campaign',
  description:
    'Get one Monaco campaign by ID, including its attached audiences, sender distribution, rules of engagement, and autopilot settings.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    campaignId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the campaign to fetch',
    },
  },

  request: {
    url: (params) =>
      `${MONACO_API_BASE}/v1/campaigns/${safeUrlPathSegment(params.campaignId, 'campaignId')}`,
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { campaign: mapMonacoCampaignDetail(data.data) } }
  },

  outputs: {
    campaign: {
      type: 'object',
      description: 'The campaign',
      properties: MONACO_CAMPAIGN_DETAIL_OUTPUT_PROPERTIES,
    },
  },
}
