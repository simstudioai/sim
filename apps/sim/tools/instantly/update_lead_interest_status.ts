import type {
  InstantlyUpdateLeadInterestStatusParams,
  InstantlyUpdateLeadInterestStatusResponse,
} from '@/tools/instantly/types'
import {
  asRecord,
  compactBody,
  instantlyBaseParamFields,
  instantlyHeaders,
  instantlyUrl,
  parseInstantlyResponse,
} from '@/tools/instantly/utils'
import type { ToolConfig } from '@/tools/types'

export const updateLeadInterestStatusTool: ToolConfig<
  InstantlyUpdateLeadInterestStatusParams,
  InstantlyUpdateLeadInterestStatusResponse
> = {
  id: 'instantly_update_lead_interest_status',
  name: 'Instantly Update Lead Interest Status',
  description: 'Submits an Instantly V2 background job to update a lead interest status.',
  version: '1.0.0',
  params: {
    ...instantlyBaseParamFields,
    lead_email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead email address',
    },
    interest_value: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Interest status value. Leave empty in the block or pass null to reset to Lead.',
    },
    campaign_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Campaign ID for the lead',
    },
    list_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead list ID for the lead',
    },
    ai_interest_value: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'AI interest value to set for the lead',
    },
    disable_auto_interest: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to disable auto interest',
    },
  },
  request: {
    url: () => instantlyUrl('/api/v2/leads/update-interest-status'),
    method: 'POST',
    headers: instantlyHeaders,
    body: (params) => {
      if (params.interest_value === undefined) {
        throw new Error('Interest Value is required for Instantly Update Lead Interest Status')
      }

      return compactBody({
        lead_email: params.lead_email,
        interest_value: params.interest_value,
        campaign_id: params.campaign_id,
        list_id: params.list_id,
        ai_interest_value: params.ai_interest_value,
        disable_auto_interest: params.disable_auto_interest,
      })
    },
  },
  transformResponse: async (response) => {
    const data = await parseInstantlyResponse(response)
    const result = asRecord(data)

    return {
      success: true,
      output: {
        message: typeof result.message === 'string' ? result.message : null,
      },
    }
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Background job submission message',
      optional: true,
    },
  },
}
