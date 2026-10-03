import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadActionResponse, SmartleadCampaignLeadParams } from '@/tools/smartlead/types'
import {
  actionOutputs,
  isOk,
  jsonBody,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadLeadIdParamField,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface ResumeLeadParams extends SmartleadCampaignLeadParams {
  resumeLeadWithDelayDays?: number
}

export const resumeLeadTool: ToolConfig<ResumeLeadParams, SmartleadActionResponse> = {
  id: 'smartlead_resume_lead',
  name: 'Smartlead Resume Lead',
  description: 'Resumes a paused lead in a Smartlead campaign, optionally after a delay.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    ...smartleadLeadIdParamField,
    resumeLeadWithDelayDays: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Days to wait before the next email; 0 resumes immediately',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(
        `/campaigns/${pathSegment(params.campaignId)}/leads/${pathSegment(params.leadId)}/resume`,
        params.apiKey
      ),
    method: 'POST',
    headers: smartleadHeaders,
    body: (params) =>
      jsonBody({
        resume_lead_with_delay_days: params.resumeLeadWithDelayDays,
      }),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'lead resume')

    return {
      success: true,
      output: { success: isOk(record) },
    }
  },
  outputs: actionOutputs,
}
