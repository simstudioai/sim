import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpMergeField } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpCreateMergeField')

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
    metadata: {
      operation: 'create_merge_field'
      mergeId: string
    }
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
      visibility: 'user-only',
      description: 'The unique ID for the list',
    },
    mergeName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The name of the merge field',
    },
    mergeType: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'The type of the merge field (text, number, address, phone, date, url, imageurl, radio, dropdown, birthday, zip)',
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
        metadata: {
          operation: 'create_merge_field' as const,
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
      description: 'Created merge field data',
      properties: {
        mergeField: { type: 'object', description: 'Created merge field object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
