import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonRedactMessage')

export interface PylonRedactMessageParams {
  apiToken: string
  issueId: string
  messageId: string
}

export interface PylonRedactMessageResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'redact_message'
      issueId: string
      messageId: string
    }
    success: boolean
  }
}

export const pylonRedactMessageTool: ToolConfig<
  PylonRedactMessageParams,
  PylonRedactMessageResponse
> = {
  id: 'pylon_redact_message',
  name: 'Redact Message in Pylon',
  description: 'Redact a specific message within an issue',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    issueId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Issue ID containing the message',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Message ID to redact',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/issues/${params.issueId}/messages/${params.messageId}/redact`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'redact_message')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'redact_message' as const,
          issueId: '',
          messageId: '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Redact operation result',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
