import type { MailchimpBatchOperation } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetBatchOperationParams {
  apiKey: string
  batchId: string
}

export interface MailchimpGetBatchOperationResponse {
  success: boolean
  output: {
    batch: MailchimpBatchOperation
    batch_id: string
  }
}

export const mailchimpGetBatchOperationTool: ToolConfig<
  MailchimpGetBatchOperationParams,
  MailchimpGetBatchOperationResponse
> = {
  id: 'mailchimp_get_batch_operation',
  name: 'Get Batch Operation from Mailchimp',
  description: 'Retrieve details of a specific batch operation from Mailchimp',
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
      description: 'The unique ID for the batch operation (e.g., "abc123def4")',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/batches/${params.batchId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_batch_operation')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        batch: data,
        batch_id: data.id,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the batch operation was successfully retrieved',
    },
    output: {
      type: 'object',
      description: 'Batch operation data',
      properties: {
        batch: { type: 'json', description: 'Batch operation object' },
        batch_id: { type: 'string', description: 'The unique ID of the batch operation' },
      },
    },
  },
}
