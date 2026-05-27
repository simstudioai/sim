import type { InstantlyCreateLeadParams, InstantlyLeadResponse } from '@/tools/instantly/types'
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

export const createLeadTool: ToolConfig<InstantlyCreateLeadParams, InstantlyLeadResponse> = {
  id: 'instantly_create_lead',
  name: 'Instantly Create Lead',
  description: 'Creates an Instantly V2 lead in a campaign or lead list.',
  version: '1.0.0',
  params: {
    ...instantlyBaseParamFields,
    campaign: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Campaign ID associated with the lead',
    },
    list_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead list ID associated with the lead',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead email address. Required when adding to a campaign.',
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
      description: 'Organization user ID assigned to the lead',
    },
    skip_if_in_workspace: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Skip if the lead already exists in the workspace',
    },
    skip_if_in_campaign: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Skip if the lead already exists in the campaign',
    },
    skip_if_in_list: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Skip if the lead already exists in the list',
    },
    blocklist_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Blocklist ID to check for the lead',
    },
    verify_leads_for_lead_finder: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to verify leads imported from Lead Finder',
    },
    verify_leads_on_import: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to verify leads on import',
    },
    custom_variables: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom variable object with string, number, boolean, or null values',
    },
  },
  request: {
    url: () => instantlyUrl('/api/v2/leads'),
    method: 'POST',
    headers: instantlyHeaders,
    body: (params) =>
      compactBody({
        campaign: params.campaign,
        list_id: params.list_id,
        email: params.email,
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
        skip_if_in_workspace: params.skip_if_in_workspace,
        skip_if_in_campaign: params.skip_if_in_campaign,
        skip_if_in_list: params.skip_if_in_list,
        blocklist_id: params.blocklist_id,
        verify_leads_for_lead_finder: params.verify_leads_for_lead_finder,
        verify_leads_on_import: params.verify_leads_on_import,
        custom_variables: params.custom_variables,
      }),
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
