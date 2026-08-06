import { isRecordLike } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadAddLeadsResponse, SmartleadCampaignIdParams } from '@/tools/smartlead/types'
import {
  addLeadsOutputs,
  jsonBody,
  mapLeadImportResult,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

const LEAD_FIELDS = [
  'email',
  'first_name',
  'last_name',
  'phone_number',
  'company_name',
  'website',
  'location',
  'linkedin_profile',
  'company_url',
  'custom_fields',
] as const

interface AddLeadsToCampaignParams extends SmartleadCampaignIdParams {
  leads: unknown[]
  ignoreGlobalBlockList?: boolean
  ignoreUnsubscribeList?: boolean
  ignoreDuplicateLeadsInOtherCampaign?: boolean
  ignoreCommunityBounceList?: boolean
}

/** Keeps only fields Smartlead accepts so stray keys can't fail the whole import. */
function toLeadPayload(value: unknown): Record<string, unknown> {
  const record = isRecordLike(value) ? value : {}
  const payload: Record<string, unknown> = {}

  for (const field of LEAD_FIELDS) {
    if (record[field] !== undefined && record[field] !== null && record[field] !== '') {
      payload[field] = record[field]
    }
  }

  return payload
}

export const addLeadsToCampaignTool: ToolConfig<
  AddLeadsToCampaignParams,
  SmartleadAddLeadsResponse
> = {
  id: 'smartlead_add_leads_to_campaign',
  name: 'Smartlead Add Leads to Campaign',
  description:
    'Adds leads to a Smartlead campaign, up to 400 per call. Returns per-reason counts for leads that were skipped as duplicates, blocked, bounced, or invalid.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    leads: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Leads to add (max 400). Each entry requires email and accepts first_name, last_name, phone_number, company_name, website, location, linkedin_profile, company_url, and custom_fields.',
      items: { type: 'object' },
    },
    ignoreGlobalBlockList: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Add leads even if they are on the global block list',
    },
    ignoreUnsubscribeList: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Add leads even if they previously unsubscribed',
    },
    ignoreDuplicateLeadsInOtherCampaign: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Add leads even if they already exist in another campaign',
    },
    ignoreCommunityBounceList: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Add leads even if they are on the community bounce list',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/leads`, params.apiKey),
    method: 'POST',
    headers: smartleadHeaders,
    body: (params) => ({
      lead_list: (Array.isArray(params.leads) ? params.leads : []).map(toLeadPayload),
      settings: jsonBody({
        ignore_global_block_list: params.ignoreGlobalBlockList,
        ignore_unsubscribe_list: params.ignoreUnsubscribeList,
        ignore_duplicate_leads_in_other_campaign: params.ignoreDuplicateLeadsInOtherCampaign,
        ignore_community_bounce_list: params.ignoreCommunityBounceList,
      }),
    }),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'lead import')

    return {
      success: true,
      output: mapLeadImportResult(record),
    }
  },
  outputs: addLeadsOutputs,
}
