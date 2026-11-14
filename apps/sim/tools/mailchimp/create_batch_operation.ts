import type { MailchimpBatchOperation } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import { MAILCHIMP_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpCreateBatchOperationParams {
  apiKey: string
  operations: string | unknown[]
}

export interface MailchimpCreateBatchOperationResponse {
  success: boolean
  output: {
    batch: MailchimpBatchOperation
    batch_id: string
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
  oauth: MAILCHIMP_CREDENTIAL_OAUTH,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailchimp API key with server prefix',
    },
    operations: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of batch operations (e.g., [{"method": "POST", "path": "/lists/{list_id}/members", "body": {"email_address": "user@example.com", "status": "subscribed"}}]); an object body is sent as the JSON string Mailchimp expects',
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
      let operations: unknown = params.operations
      if (typeof operations === 'string') {
        try {
          operations = JSON.parse(operations)
        } catch {
          throw new Error('Operations must be a JSON array of batch operations')
        }
      }

      if (!Array.isArray(operations)) {
        throw new Error('Operations must be a JSON array of batch operations')
      }

      return {
        operations: operations.map((operation: unknown) => {
          if (!operation || typeof operation !== 'object') return operation
          const { body, ...rest } = operation as Record<string, unknown>
          if (body === undefined || body === null || typeof body === 'string') return operation
          return { ...rest, body: JSON.stringify(body) }
        }),
      }
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
        batch_id: data.id,
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
        batch: { type: 'json', description: 'Created batch operation object' },
        batch_id: { type: 'string', description: 'Created batch operation ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
