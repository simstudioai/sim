import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  ModalChatCompletionApiResponse,
  ModalChatCompletionParams,
  ModalChatCompletionResponse,
} from '@/tools/modal/types'
import {
  extractModalError,
  MAX_MODAL_RESPONSE_BODY_BYTES,
  MODAL_SHARED_INFERENCE_URL,
  modalOpenAiUrl,
  modalProxyAuthHeaders,
  toOptionalNumber,
} from '@/tools/modal/utils'
import type { ToolConfig } from '@/tools/types'

export const modalChatCompletionTool: ToolConfig<
  ModalChatCompletionParams,
  ModalChatCompletionResponse
> = {
  id: 'modal_chat_completion',
  name: 'Modal Chat Completion',
  description: 'Generate a chat completion from a model served by a Modal Endpoint',
  version: '1.0.0',

  params: {
    endpointUrl: {
      type: 'string',
      required: false,
      default: MODAL_SHARED_INFERENCE_URL,
      visibility: 'user-or-llm',
      description:
        'Endpoint URL from the Modal dashboard or `modal endpoint list`. Defaults to https://inference.us-west.modal.direct, which routes to Shared Endpoints on the model ID',
    },
    model: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Model to generate with — the base model repo ID for a dedicated endpoint, or the endpoint hostname for a Shared Endpoint',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user message content to send to the model',
    },
    systemPrompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'System prompt to guide the model behavior',
    },
    maxTokens: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of tokens to generate',
    },
    temperature: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sampling temperature (e.g., 0 for deterministic, 0.7 for creative)',
    },
    topP: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Nucleus sampling probability mass between 0 and 1',
    },
    tokenId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Modal proxy token ID (wk-...)',
    },
    tokenSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Modal proxy token secret (ws-...)',
    },
  },

  request: {
    modelInput: {
      mode: 'project',
      select: (params) => ({
        systemPrompt: params.systemPrompt,
        content: params.content,
      }),
    },
    url: (params) =>
      modalOpenAiUrl(params.endpointUrl?.trim() || MODAL_SHARED_INFERENCE_URL, '/chat/completions'),
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      ...modalProxyAuthHeaders(params, { required: true }),
    }),
    body: (params) => {
      const messages: Array<{ role: string; content: string }> = []
      if (params.systemPrompt) {
        messages.push({ role: 'system', content: params.systemPrompt })
      }
      messages.push({ role: 'user', content: params.content })

      const body: Record<string, unknown> = { model: params.model, messages }

      const maxTokens = toOptionalNumber(params.maxTokens)
      if (maxTokens !== undefined) body.max_tokens = maxTokens
      const temperature = toOptionalNumber(params.temperature)
      if (temperature !== undefined) body.temperature = temperature
      const topP = toOptionalNumber(params.topP)
      if (topP !== undefined) body.top_p = topP

      return body
    },
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      throw new Error(await extractModalError(response, 'Modal chat completion failed'))
    }

    const data = await readResponseJsonWithLimit<ModalChatCompletionApiResponse>(response, {
      maxBytes: MAX_MODAL_RESPONSE_BODY_BYTES,
      label: 'Modal chat completion response body',
    })
    const choice = data?.choices?.[0]

    return {
      success: true,
      output: {
        content: choice?.message?.content ?? '',
        model: data?.model ?? params?.model ?? '',
        finishReason: choice?.finish_reason ?? null,
        usage: {
          prompt_tokens: data?.usage?.prompt_tokens ?? null,
          completion_tokens: data?.usage?.completion_tokens ?? null,
          total_tokens: data?.usage?.total_tokens ?? null,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Generated text content' },
    model: { type: 'string', description: 'Model that produced the completion' },
    finishReason: {
      type: 'string',
      description: 'Why generation stopped (e.g., stop, length)',
      optional: true,
    },
    usage: {
      type: 'object',
      description: 'Token usage reported by the endpoint',
      properties: {
        prompt_tokens: {
          type: 'number',
          description: 'Number of tokens in the prompt',
          optional: true,
        },
        completion_tokens: {
          type: 'number',
          description: 'Number of tokens in the completion',
          optional: true,
        },
        total_tokens: {
          type: 'number',
          description: 'Total number of tokens used',
          optional: true,
        },
      },
    },
  },
}
