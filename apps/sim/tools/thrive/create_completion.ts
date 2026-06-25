import type {
  ThriveCreateCompletionParams,
  ThriveCreateCompletionResponse,
} from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const createCompletionTool: ToolConfig<
  ThriveCreateCompletionParams,
  ThriveCreateCompletionResponse
> = {
  id: 'thrive_create_completion',
  name: 'Thrive Create Completion',
  description: 'Record a learning completion in Thrive for a user and content item.',
  version: '1.0.0',

  params: {
    tenantId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thrive Tenant ID (used as the Basic auth username)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thrive API key (used as the Basic auth password)',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Region-specific API host',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user ID',
    },
    contentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The content ID for the content completed',
    },
    completedAt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ISO8601 timestamp when the completion occurred',
    },
  },

  request: {
    url: (params) => `${getThriveBaseUrl(params.host, 'v1')}/learning/completions`,
    method: 'POST',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
    body: (params) => ({
      userId: params.userId,
      contentId: params.contentId,
      completedAt: params.completedAt,
    }),
  },

  transformResponse: async (response: Response): Promise<ThriveCreateCompletionResponse> => {
    const data = await parseThriveResponse(response, 'Failed to create completion')
    return { success: true, output: { statementId: data?.statementId ?? null } }
  },

  outputs: {
    statementId: { type: 'string', description: 'The completion statement ID' },
  },
}
