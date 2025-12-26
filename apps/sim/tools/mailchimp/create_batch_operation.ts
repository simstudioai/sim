import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpBatchOperation } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpCreateBatchOperation')

export interface MailchimpCreateBatchOperationParams {
  apiKey: string
  operations: string
}

export interface MailchimpCreateBatchOperationResponse {
  success: boolean
  output: {
    batch: MailchimpBatchOperation
    metadata: {
      operation: 'create_batch_operation'
      batchId: string
    }
    success: boolean
  }
}

export const mailchimpCreateBatchOperationTool: ToolConfig<
  MailchimpCreateBatchOperationParams,
  MailchimpCreateBatchOperationResponse
> = {
  id: 'mailchimp_create_batch_operation',
  name: 'Create Batch Operation in Mailchimp',
  description: 'Create a new batch operation in Mailchimp',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    operations: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'JSON array of operations',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, '/batches'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let operations = []
      try {
        operations = JSON.parse(params.operations)
      } catch (error) {
        logger.warn('Failed to parse operations', { error })
      }

      return { operations }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'create_batch_operation')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        batch: data,
        metadata: {
          operation: 'create_batch_operation' as const,
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
      description: 'Created batch operation data',
      properties: {
        batch: { type: 'object', description: 'Created batch operation object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
