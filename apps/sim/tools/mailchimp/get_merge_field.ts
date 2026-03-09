import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetMergeFieldParams {
  apiKey: string
  listId: string
  mergeId: string
}

export interface MailchimpGetMergeFieldResponse {
  success: boolean
  output: {
    mergeField: any
    merge_id: string
  }
}

export const mailchimpGetMergeFieldTool: ToolConfig<
  MailchimpGetMergeFieldParams,
  MailchimpGetMergeFieldResponse
> = {
  id: 'mailchimp_get_merge_field',
  name: 'Get Merge Field from Mailchimp Audience',
  description: 'Retrieve details of a specific merge field from a Mailchimp audience',
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
      description: 'The unique ID for the merge field (e.g., "1" or "FNAME")',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/merge-fields/${params.mergeId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_merge_field')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        mergeField: data,
        merge_id: data.merge_id,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the merge field was successfully retrieved' },
    output: {
      type: 'object',
      description: 'Merge field data',
      properties: {
        mergeField: { type: 'json', description: 'Merge field object' },
        merge_id: { type: 'string', description: 'The unique ID of the merge field' },
      },
    },
  },
}
