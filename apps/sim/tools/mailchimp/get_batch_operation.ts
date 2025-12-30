import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpBatchOperation } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetBatchOperation')

export interface MailchimpGetBatchOperationParams {
  apiKey: string
  batchId: string
}

export interface MailchimpGetBatchOperationResponse {
  success: boolean
  output: {
    batch: MailchimpBatchOperation
    metadata: {
      operation: 'get_batch_operation'
      batchId: string
    }
    success: boolean
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
      visibility: 'user-only',
      description: 'The unique ID for the batch operation',
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
        metadata: {
          operation: 'get_batch_operation' as const,
          batchId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Batch operation data and metadata',
      properties: {
        batch: { type: 'object', description: 'Batch operation object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
