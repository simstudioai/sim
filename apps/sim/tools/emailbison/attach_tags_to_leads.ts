import type {
  EmailBisonActionResponse,
  EmailBisonAttachTagsToLeadsParams,
} from '@/tools/emailbison/types'
import {
  actionOutput,
  actionOutputs,
  emailBisonBaseParamFields,
  emailBisonHeaders,
  emailBisonRecordData,
  emailBisonUrl,
  jsonBody,
} from '@/tools/emailbison/utils'
import type { ToolConfig } from '@/tools/types'

export const attachTagsToLeadsTool: ToolConfig<
  EmailBisonAttachTagsToLeadsParams,
  EmailBisonActionResponse
> = {
  id: 'emailbison_attach_tags_to_leads',
  name: 'Email Bison Attach Tags to Leads',
  description: 'Attaches Email Bison tags to one or more leads.',
  version: '1.0.0',
  params: {
    ...emailBisonBaseParamFields,
    tagIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tag IDs to attach',
      items: { type: 'number', description: 'Tag ID' },
    },
    leadIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead IDs to tag',
      items: { type: 'number', description: 'Lead ID' },
    },
    skipWebhooks: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Skip Email Bison webhooks for this action',
    },
  },
  request: {
    url: (params) => emailBisonUrl('/api/tags/attach-to-leads', {}, params.apiBaseUrl),
    method: 'POST',
    headers: emailBisonHeaders,
    body: (params) =>
      jsonBody({
        tag_ids: params.tagIds,
        lead_ids: params.leadIds,
        skip_webhooks: params.skipWebhooks,
      }),
  },
  transformResponse: async (response) => {
    const data = await emailBisonRecordData(response, 'tag attachment result')

    return {
      success: true,
      output: actionOutput(data),
    }
  },
  outputs: actionOutputs,
}
