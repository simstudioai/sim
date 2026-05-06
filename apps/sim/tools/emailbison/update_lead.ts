import type { EmailBisonLeadMutationParams, EmailBisonLeadResponse } from '@/tools/emailbison/types'
import {
  emailBisonBaseParamFields,
  emailBisonHeaders,
  emailBisonRecordData,
  emailBisonUrl,
  jsonBody,
  leadOutputs,
  mapLead,
} from '@/tools/emailbison/utils'
import type { ToolConfig } from '@/tools/types'

export const updateLeadTool: ToolConfig<EmailBisonLeadMutationParams, EmailBisonLeadResponse> = {
  id: 'emailbison_update_lead',
  name: 'Email Bison Update Lead',
  description:
    'Updates an existing Email Bison lead. Fields omitted from a PUT update may be cleared by Email Bison.',
  version: '1.0.0',
  params: {
    ...emailBisonBaseParamFields,
    leadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead ID or email address',
    },
    firstName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead first name',
    },
    lastName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead last name',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead email address',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead job title',
    },
    company: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead company',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional notes about the lead',
    },
    customVariables: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom variables to store on the lead',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Custom variable name' },
          value: { type: 'string', description: 'Custom variable value' },
        },
      },
    },
  },
  request: {
    url: (params) =>
      emailBisonUrl(
        `/api/leads/${encodeURIComponent(params.leadId?.trim() ?? '')}`,
        {},
        params.apiBaseUrl
      ),
    method: 'PUT',
    headers: emailBisonHeaders,
    body: (params) =>
      jsonBody({
        first_name: params.firstName,
        last_name: params.lastName,
        email: params.email,
        title: params.title,
        company: params.company,
        notes: params.notes,
        custom_variables: params.customVariables,
      }),
  },
  transformResponse: async (response) => {
    const data = await emailBisonRecordData(response, 'lead')

    return {
      success: true,
      output: mapLead(data),
    }
  },
  outputs: leadOutputs,
}
