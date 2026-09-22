import { consumeOrCancelBody, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type { StreamingExecution } from '@/executor/types'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { createSettledAgentEventStream } from '@/providers/stream-events'
import { createStreamingExecution } from '@/providers/streaming-execution'
import { PROVIDER_HEADERS_TIMEOUT_MS } from '@/providers/transport'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'
import { buildJevBody, parseJevResponse } from '@/providers/typesafe/schema'
import { calculateCost } from '@/providers/utils'

const MAX_EVALUATION_RESPONSE_BYTES = 10 * 1024 * 1024

export const typesafeProvider: ProviderConfig = {
  id: 'typesafe',
  name: 'TypeSafe',
  description: 'Jev native evaluation models',
  version: '1.0.0',
  models: getProviderModels('typesafe'),
  defaultModel: getProviderDefaultModel('typesafe'),

  async executeRequest(request: ProviderRequest): Promise<ProviderResponse | StreamingExecution> {
    if (!request.apiKey) throw new Error('API key is required for TypeSafe')
    if (!request.evaluation) throw new Error('Jev requires evaluation state and questions')
    if (
      request.messages?.length ||
      request.systemPrompt ||
      request.context ||
      request.tools?.length ||
      request.responseFormat ||
      request.previousInteractionId
    ) {
      throw new Error(
        'Jev accepts evaluation state and questions, not chat messages, tools, or response formats'
      )
    }

    const body = buildJevBody(
      { model: request.model, state: request.evaluation.state },
      request.evaluation.questions
    )
    const start = Date.now()
    const startTime = new Date(start).toISOString()
    const timeout = AbortSignal.timeout(PROVIDER_HEADERS_TIMEOUT_MS)
    const signal = request.abortSignal ? AbortSignal.any([request.abortSignal, timeout]) : timeout
    signal.throwIfAborted()
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      redirect: 'error',
    })
    if (!response.ok) {
      await consumeOrCancelBody(response)
      throw new Error(`TypeSafe evaluation failed (HTTP ${response.status})`)
    }
    const result = parseJevResponse(
      await readResponseJsonWithLimit(response, {
        maxBytes: MAX_EVALUATION_RESPONSE_BYTES,
        label: 'TypeSafe evaluation response',
        signal,
      }),
      body.questions
    )
    const content = JSON.stringify(result.answers)
    const tokens = {
      input: result.usage.input_tokens,
      output: result.usage.output_tokens,
      total: result.usage.input_tokens + result.usage.output_tokens,
    }
    const cost = calculateCost(request.model, tokens.input, tokens.output)
    if (request.stream) {
      return createStreamingExecution({
        model: result.model,
        providerStartTime: start,
        providerStartTimeISO: startTime,
        timing: { kind: 'simple', segmentName: result.model },
        initialTokens: tokens,
        initialCost: cost,
        isStreaming: true,
        streamFormat: 'agent-events-v1',
        createStream: ({ output, finalizeTiming }) => {
          output.content = content
          output.answers = result.answers
          finalizeTiming()
          return createSettledAgentEventStream(content)
        },
      })
    }
    const end = Date.now()
    return {
      content,
      answers: result.answers,
      model: result.model,
      tokens,
      cost,
      timing: {
        startTime,
        endTime: new Date(end).toISOString(),
        duration: end - start,
        modelTime: end - start,
        toolsTime: 0,
        iterations: 1,
        timeSegments: [
          {
            type: 'model',
            name: result.model,
            startTime: start,
            endTime: end,
            duration: end - start,
            tokens,
            cost,
          },
        ],
      },
    }
  },
}
