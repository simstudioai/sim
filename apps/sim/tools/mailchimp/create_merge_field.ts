import type { MailchimpMergeField } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpCreateMergeFieldParams {
  apiKey: string
  listId: string
  mergeName: string
  mergeType: string
}

export interface MailchimpCreateMergeFieldResponse {
  success: boolean
  output: {
    mergeField: MailchimpMergeField
    merge_id: string
    success: boolean
  }
}

export const mailchimpCreateMergeFieldTool: ToolConfig<
  MailchimpCreateMergeFieldParams,
  MailchimpCreateMergeFieldResponse
> = {
  id: 'mailchimp_create_merge_field',
  name: 'Create Merge Field in Mailchimp Audience',
  description: 'Create a new merge field in a Mailchimp audience',
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
    mergeName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the merge field (e.g., "First Name")',
    },
    mergeType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The type of the merge field: "text", "number", "address", "phone", "date", "url", "imageurl", "radio", "dropdown", "birthday", or "zip"',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/merge-fields`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      name: params.mergeName,
      type: params.mergeType,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'create_merge_field')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        mergeField: data,
        merge_id: data.merge_id,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created merge field data',
      properties: {
        mergeField: { type: 'json', description: 'Created merge field object' },
        merge_id: { type: 'string', description: 'Created merge field ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
