import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpDeleteBatchOperationParams {
  apiKey: string
  batchId: string
}

export interface MailchimpDeleteBatchOperationResponse {
  success: boolean
}

export const mailchimpDeleteBatchOperationTool: ToolConfig<
  MailchimpDeleteBatchOperationParams,
  MailchimpDeleteBatchOperationResponse
> = {
  id: 'mailchimp_delete_batch_operation',
  name: 'Delete Batch Operation from Mailchimp',
  description: 'Delete a batch operation from Mailchimp',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    batchId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the batch operation to delete (e.g., "abc123def4")',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/batches/${params.batchId}`),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'delete_batch_operation')
    }

    return {
      success: true,
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the batch operation was successfully deleted',
    },
  },
}
