import type { HttpMethod, TableRow, ToolResponse } from '@/tools/types'

/**
 * Modal proxy-token pair. The token ID starts with `wk-` and the secret with
 * `ws-`; both are created with `modal workspace proxy-tokens create`.
 */
export interface ModalProxyTokenParams {
  tokenId?: string
  tokenSecret?: string
}

export interface ModalCallFunctionParams extends ModalProxyTokenParams {
  url: string
  method?: HttpMethod
  queryParams?: TableRow[] | Record<string, string> | string
  headers?: TableRow[] | Record<string, string> | string
  body?: unknown
}

export interface ModalChatCompletionParams extends ModalProxyTokenParams {
  endpointUrl: string
  model: string
  content: string
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  topP?: number
}

export interface ModalListModelsParams extends ModalProxyTokenParams {
  endpointUrl?: string
}

export interface ModalCallFunctionResponse extends ToolResponse {
  output: {
    data: unknown
    status: number
    headers: Record<string, string>
  }
}

export interface ModalChatCompletionResponse extends ToolResponse {
  output: {
    content: string
    model: string
    finishReason: string | null
    usage: {
      prompt_tokens: number | null
      completion_tokens: number | null
      total_tokens: number | null
    }
  }
}

export interface ModalModelSummary {
  id: string
  object: string | null
  created: number | null
  ownedBy: string | null
}

export interface ModalListModelsResponse extends ToolResponse {
  output: {
    models: ModalModelSummary[]
    count: number
  }
}
