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

interface UpdateLeadCategoryParams extends SmartleadCampaignLeadParams {
  categoryId: number
  pauseLead?: boolean
}

export const updateLeadCategoryTool: ToolConfig<UpdateLeadCategoryParams, SmartleadActionResponse> =
  {
    id: 'smartlead_update_lead_category',
    name: 'Smartlead Update Lead Category',
    description:
      'Sets the category of a lead in a Smartlead campaign, such as Interested or Not Interested. Use List Lead Categories to resolve a category ID.',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
    params: {
      ...smartleadBaseParamFields,
      ...smartleadCampaignIdParamField,
      ...smartleadLeadIdParamField,
      categoryId: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'Lead category ID to apply',
      },
      pauseLead: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Also pause the lead sequence when applying the category',
      },
    },
    request: {
      url: (params) =>
        smartleadUrl(
          `/campaigns/${pathSegment(params.campaignId)}/leads/${pathSegment(params.leadId)}/category`,
          params.apiKey
        ),
      method: 'POST',
      headers: smartleadHeaders,
      body: (params) =>
        jsonBody({
          category_id: params.categoryId,
          pause_lead: params.pauseLead,
        }),
    },
    transformResponse: async (response) => {
      const record = await smartleadRecord(response, 'lead category update')

      return {
        success: true,
        output: { success: isOk(record) },
      }
    },
    outputs: actionOutputs,
  }
