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

interface UpdateLeadParams extends SmartleadCampaignLeadParams {
  email: string
  firstName?: string
  lastName?: string
  phoneNumber?: string
  companyName?: string
  website?: string
  location?: string
  linkedinProfile?: string
  companyUrl?: string
  customFields?: Record<string, unknown>
}

export const updateLeadTool: ToolConfig<UpdateLeadParams, SmartleadActionResponse> = {
  id: 'smartlead_update_lead',
  name: 'Smartlead Update Lead',
  description:
    'Updates a lead in a Smartlead campaign. Smartlead requires the email field even when it is unchanged, and lead edits apply across every campaign the lead belongs to.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    ...smartleadLeadIdParamField,
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead email address — required by Smartlead even when unchanged',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead first name',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead last name',
    },
    phoneNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead phone number',
    },
    companyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead company name',
    },
    website: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead website',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead location',
    },
    linkedinProfile: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead LinkedIn profile URL',
    },
    companyUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead company URL',
    },
    customFields: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom field values keyed by field name (max 200 keys)',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(
        `/campaigns/${pathSegment(params.campaignId)}/leads/${pathSegment(params.leadId)}`,
        params.apiKey
      ),
    method: 'POST',
    headers: smartleadHeaders,
    body: (params) =>
      jsonBody({
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
        phone_number: params.phoneNumber,
        company_name: params.companyName,
        website: params.website,
        location: params.location,
        linkedin_profile: params.linkedinProfile,
        company_url: params.companyUrl,
        custom_fields: params.customFields,
      }),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'lead update')

    return {
      success: true,
      output: { success: isOk(record) },
    }
  },
  outputs: actionOutputs,
}
