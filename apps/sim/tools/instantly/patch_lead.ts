import type { InstantlyLeadResponse, InstantlyPatchLeadParams } from '@/tools/instantly/types'
import {
  compactBody,
  instantlyBaseParamFields,
  instantlyHeaders,
  instantlyUrl,
  leadOutputs,
  mapLead,
  parseInstantlyResponse,
} from '@/tools/instantly/utils'
import type { ToolConfig } from '@/tools/types'

export const patchLeadTool: ToolConfig<InstantlyPatchLeadParams, InstantlyLeadResponse> = {
  id: 'instantly_patch_lead',
  name: 'Instantly Patch Lead',
  description: 'Updates fields on an existing Instantly V2 lead.',
  version: '1.0.0',
  params: {
    ...instantlyBaseParamFields,
    leadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead ID',
    },
    first_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead first name',
    },
    last_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead last name',
    },
    company_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead company name',
    },
    job_title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead job title',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead phone number',
    },
    website: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead website',
    },
    personalization: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead personalization text',
    },
    lt_interest_status: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead interest status value',
    },
    pl_value_lead: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Potential value of the lead',
    },
    assigned_to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the user assigned to the lead',
    },
    custom_variables: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom variable object with string, number, boolean, or null values',
    },
  },
  request: {
    url: (params) => instantlyUrl(`/api/v2/leads/${params.leadId.trim()}`),
    method: 'PATCH',
    headers: instantlyHeaders,
    body: (params) => {
      const body = compactBody({
        first_name: params.first_name,
        last_name: params.last_name,
        company_name: params.company_name,
        job_title: params.job_title,
        phone: params.phone,
        website: params.website,
        personalization: params.personalization,
        lt_interest_status: params.lt_interest_status,
        pl_value_lead: params.pl_value_lead,
        assigned_to: params.assigned_to,
        custom_variables: params.custom_variables,
      })

      if (Object.keys(body).length === 0) {
        throw new Error('Provide at least one field to update')
      }

      return body
    },
  },
  transformResponse: async (response) => {
    const data = await parseInstantlyResponse(response)
    const lead = mapLead(data)

    return {
      success: true,
      output: {
        lead,
        id: lead.id,
        email_address: lead.email,
        first_name: lead.first_name,
        last_name: lead.last_name,
        campaign: lead.campaign,
        status: lead.status,
      },
    }
  },
  outputs: leadOutputs,
}
