import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpDeleteMergeFieldParams {
  apiKey: string
  listId: string
  mergeId: string
}

export interface MailchimpDeleteMergeFieldResponse {
  success: boolean
}

export const mailchimpDeleteMergeFieldTool: ToolConfig<
  MailchimpDeleteMergeFieldParams,
  MailchimpDeleteMergeFieldResponse
> = {
  id: 'mailchimp_delete_merge_field',
  name: 'Delete Merge Field from Mailchimp Audience',
  description: 'Delete a merge field from a Mailchimp audience',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the audience/list (e.g., "abc123def4")',
    },
    mergeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the merge field to delete (e.g., "1" or "FNAME")',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/merge-fields/${params.mergeId}`),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'delete_merge_field')
    }

    return {
      success: true,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the merge field was successfully deleted' },
  },
}
