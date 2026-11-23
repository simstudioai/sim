import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_CAMPAIGN_DETAIL_OUTPUT_PROPERTIES,
  type MonacoAddCampaignAudiencesParams,
  type MonacoCampaignDetailResponse,
} from '@/tools/monaco/types'
import {
  MONACO_API_BASE,
  mapMonacoCampaignDetail,
  monacoHeaders,
  parseMonacoIdList,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoAddCampaignAudiencesTool: ToolConfig<
  MonacoAddCampaignAudiencesParams,
  MonacoCampaignDetailResponse
> = {
  id: 'monaco_add_campaign_audiences',
  name: 'Monaco Add Campaign Audiences',
  description:
    'Attach audiences to a Monaco campaign, keeping its existing ones, and return the refreshed campaign. This sends real outreach: every contact in the attached audiences is enrolled asynchronously and the campaign sequence sends them real emails and LinkedIn messages. Audiences already attached are ignored, so retries are safe.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    campaignId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the campaign to attach audiences to',
    },
    audienceIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'IDs of the audiences to attach (at least one), as an array or comma-separated list',
      items: { type: 'string' },
    },
  },

  request: {
    url: (params) =>
      `${MONACO_API_BASE}/v1/campaigns/${safeUrlPathSegment(params.campaignId, 'campaignId')}/audiences`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => ({ audience_ids: parseMonacoIdList(params.audienceIds, 'audienceIds') }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { campaign: mapMonacoCampaignDetail(data.data) } }
  },

  outputs: {
    campaign: {
      type: 'object',
      description: 'The refreshed campaign with its attached audiences',
      properties: MONACO_CAMPAIGN_DETAIL_OUTPUT_PROPERTIES,
    },
  },
}
