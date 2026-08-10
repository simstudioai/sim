import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadActionResponse, SmartleadCampaignIdParams } from '@/tools/smartlead/types'
import {
  actionOutputs,
  isOk,
  jsonBody,
  pathSegment,
  type SMARTLEAD_STOP_LEAD_SETTINGS,
  type SMARTLEAD_TRACK_SETTINGS,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface UpdateCampaignSettingsParams extends SmartleadCampaignIdParams {
  trackSettings?: (typeof SMARTLEAD_TRACK_SETTINGS)[number][]
  stopLeadSettings?: (typeof SMARTLEAD_STOP_LEAD_SETTINGS)[number]
  sendAsPlainText?: boolean
  followUpPercentage?: number
  unsubscribeText?: string
  enableAiEspMatching?: boolean
}

export const updateCampaignSettingsTool: ToolConfig<
  UpdateCampaignSettingsParams,
  SmartleadActionResponse
> = {
  id: 'smartlead_update_campaign_settings',
  name: 'Smartlead Update Campaign Settings',
  description: 'Updates tracking, stop-on-activity, and sending settings for a Smartlead campaign.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    trackSettings: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Tracking to disable. Allowed values: DONT_TRACK_EMAIL_OPEN, DONT_TRACK_LINK_CLICK, DONT_TRACK_REPLY_TO_AN_EMAIL',
      items: { type: 'string' },
    },
    stopLeadSettings: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Lead activity that stops the sequence: REPLY_TO_AN_EMAIL, CLICK_ON_A_LINK, OPEN_AN_EMAIL',
    },
    sendAsPlainText: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Send campaign emails as plain text',
    },
    followUpPercentage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Percentage of leads that receive follow-ups',
    },
    unsubscribeText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unsubscribe text appended to emails',
    },
    enableAiEspMatching: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Match sending accounts to recipient email providers',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/settings`, params.apiKey),
    method: 'POST',
    headers: smartleadHeaders,
    body: (params) =>
      jsonBody({
        track_settings: params.trackSettings,
        stop_lead_settings: params.stopLeadSettings,
        send_as_plain_text: params.sendAsPlainText,
        follow_up_percentage: params.followUpPercentage,
        unsubscribe_text: params.unsubscribeText,
        enable_ai_esp_matching: params.enableAiEspMatching,
      }),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'settings update')

    return {
      success: true,
      output: { success: isOk(record) },
    }
  },
  outputs: actionOutputs,
}
