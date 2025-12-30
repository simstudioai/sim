import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpMergeField } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpUpdateMergeField')

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
    metadata: {
      operation: 'update_merge_field'
      mergeId: string
    }
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
      visibility: 'user-only',
      description: 'The unique ID for the list',
    },
    mergeId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The unique ID for the merge field',
    },
    mergeName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The name of the merge field',
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
        metadata: {
          operation: 'update_merge_field' as const,
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
      description: 'Updated merge field data',
      properties: {
        mergeField: { type: 'object', description: 'Updated merge field object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
