import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpDeleteMergeField')

export interface MailchimpDeleteMergeFieldParams {
  apiKey: string
  listId: string
  mergeId: string
}

export interface MailchimpDeleteMergeFieldResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'delete_merge_field'
      mergeId: string
    }
    success: boolean
  }
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
      visibility: 'user-only',
      description: 'The unique ID for the list',
    },
    mergeId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The unique ID for the merge field to delete',
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
      output: {
        metadata: {
          operation: 'delete_merge_field' as const,
          mergeId: '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deletion confirmation',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
