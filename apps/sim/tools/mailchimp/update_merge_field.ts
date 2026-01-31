import type { MailchimpMergeField } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpUpdateMergeFieldParams {
  apiKey: string
  listId: string
  mergeId: string
  mergeName?: string
}

export interface MailchimpUpdateMergeFieldResponse {
  success: boolean
  output: {
    mergeField: MailchimpMergeField
    merge_id: string
    success: boolean
  }
}

export const mailchimpUpdateMergeFieldTool: ToolConfig<
  MailchimpUpdateMergeFieldParams,
  MailchimpUpdateMergeFieldResponse
> = {
  id: 'mailchimp_update_merge_field',
  name: 'Update Merge Field in Mailchimp Audience',
  description: 'Update an existing merge field in a Mailchimp audience',
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
    mergeName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The name of the merge field (e.g., "First Name")',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/merge-fields/${params.mergeId}`),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.mergeName) body.name = params.mergeName

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'update_merge_field')
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
      description: 'Updated merge field data',
      properties: {
        mergeField: { type: 'object', description: 'Updated merge field object' },
        merge_id: { type: 'string', description: 'Merge field ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
