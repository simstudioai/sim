import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetMergeField')

export interface MailchimpGetMergeFieldParams {
  apiKey: string
  listId: string
  mergeId: string
}

export interface MailchimpGetMergeFieldResponse {
  success: boolean
  output: {
    mergeField: any
    metadata: {
      operation: 'get_merge_field'
      mergeId: string
    }
    success: boolean
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
      visibility: 'user-only',
      description: 'The unique ID for the list',
    },
    mergeId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The unique ID for the merge field',
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
        metadata: {
          operation: 'get_merge_field' as const,
          mergeId: data.merge_id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Merge field data and metadata',
      properties: {
        mergeField: { type: 'object', description: 'Merge field object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
