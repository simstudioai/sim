import { createLogger } from '@/lib/logs/console/logger'
import { env } from '@/lib/env'
import type { StreamingExecution } from '@/executor/types'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'

const logger = createLogger('VLLMProvider')
const VLLM_VERSION = '1.0.0'

function buildMessages(request: ProviderRequest) {
  const messages: any[] = []

  if (request.systemPrompt) {
    messages.push({ role: 'system', content: request.systemPrompt })
  }

  if (request.context) {
    messages.push({ role: 'user', content: request.context })
  }

  if (request.messages?.length) {
    messages.push(...request.messages)
  }

  return messages
}

function buildTools(request: ProviderRequest) {
  if (!request.tools?.length) return undefined

  return request.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.id,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

function mapToolCalls(toolCalls: any[] | undefined) {
  if (!toolCalls?.length) return undefined

  return toolCalls.map((toolCall) => ({
    name: toolCall.function?.name,
    arguments: (() => {
      try {
        return JSON.parse(toolCall.function?.arguments || '{}')
      } catch {
        return {}
      }
    })(),
  }))
}

function mapTiming(startTime: number, endTime: number): { timing: ProviderResponse['timing'] } {
  const end = endTime || Date.now()
  const duration = end - startTime
  const timeSegments: TimeSegment[] = [
    {
      type: 'model',
      name: 'vllm',
      startTime,
      endTime: end,
      duration,
    },
  ]

  return {
    timing: {
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(end).toISOString(),
      duration,
      timeSegments,
    },
  }
}

export const vllmProvider: ProviderConfig = {
  id: 'vllm',
  name: 'vLLM',
  description: 'Self-hosted vLLM with OpenAI-compatible API',
  version: VLLM_VERSION,
  models: getProviderModels('vllm'),
  defaultModel: getProviderDefaultModel('vllm'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | ReadableStream | StreamingExecution> => {
    const start = Date.now()

    const baseUrl = (request.azureEndpoint || env.VLLM_BASE_URL || '').replace(/\/$/, '')
    if (!baseUrl) {
      throw new Error('VLLM_BASE_URL is required for vLLM provider')
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const apiKey = request.apiKey || env.VLLM_API_KEY
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const tools = buildTools(request)

    const payload: any = {
      model: request.model || getProviderDefaultModel('vllm'),
      messages: buildMessages(request),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: request.stream === true,
    }

    if (request.responseFormat) {
      payload.response_format = {
        type: 'json_schema',
        schema: request.responseFormat.schema || request.responseFormat,
      }
    }

    if (tools) {
      payload.tools = tools
      // For now, always allow auto tool selection; vLLM supports the OpenAI schema.
      payload.tool_choice = 'auto'
    }

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `vLLM request failed: ${response.status} ${response.statusText} - ${text || 'No body'}`
      )
    }

    // Streaming path: return the raw stream; upstream handles it as ReadableStream
    if (request.stream && response.body) {
      return response.body
    }

    const json = await response.json()
    const choice = json?.choices?.[0]
    const content = choice?.message?.content || ''
    const toolCalls = mapToolCalls(choice?.message?.tool_calls)

    const usage = json?.usage || {}

    const result: ProviderResponse = {
      content,
      model: json?.model || payload.model,
      tokens: {
        prompt: usage.prompt_tokens,
        completion: usage.completion_tokens,
        total: usage.total_tokens,
      },
      toolCalls,
      ...mapTiming(start, Date.now()),
    }

    return result
  },
}
