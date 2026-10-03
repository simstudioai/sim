import type OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { setNativeConversationMessage } from '@/providers/conversation-metadata'
import {
  buildResponsesInputFromMessages,
  convertToolsToResponses,
  createReadableStreamFromResponses,
  parseResponsesUsage,
  toOpenAIModelUsage,
} from '@/providers/openai/utils'
import { runWithProviderRuntimeContext } from '@/providers/runtime-context'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { Message } from '@/providers/types'

describe('parseResponsesUsage', () => {
  it('reads cache writes, which GPT-5.6+ bills at a premium', () => {
    const usage = parseResponsesUsage({
      input_tokens: 1000,
      output_tokens: 100,
      total_tokens: 1100,
      input_tokens_details: { cached_tokens: 600, cache_write_tokens: 200 },
      output_tokens_details: { reasoning_tokens: 0 },
    } as OpenAI.Responses.ResponseUsage)

    expect(usage).toMatchObject({ promptTokens: 1000, cachedTokens: 600, cacheWriteTokens: 200 })
  })

  it('reports zero cache writes on model families that do not charge for them', () => {
    const usage = parseResponsesUsage({
      input_tokens: 1000,
      output_tokens: 100,
      total_tokens: 1100,
      input_tokens_details: { cached_tokens: 600 },
      output_tokens_details: { reasoning_tokens: 0 },
    } as OpenAI.Responses.ResponseUsage)

    expect(usage?.cacheWriteTokens).toBe(0)
  })
})

describe('toOpenAIModelUsage', () => {
  /**
   * OpenAI reports cached and written tokens as subsets of `input_tokens`;
   * double-counting them would over-bill every cached request.
   */
  it('subtracts cache buckets out of the prompt total', () => {
    const usage = toOpenAIModelUsage({
      promptTokens: 1000,
      completionTokens: 100,
      totalTokens: 1100,
      cachedTokens: 600,
      cacheWriteTokens: 200,
      reasoningTokens: 0,
    })

    expect(usage).toEqual({
      input: 200,
      output: 100,
      cacheRead: 600,
      cacheWrites: [{ tokens: 200, inputRateMultiplier: 1.25 }],
    })
  })

  /**
   * OpenAI has shipped payloads where reads plus writes exceeded the prompt
   * total. Left unclamped that bills more input than the request contained.
   */
  it('never bills more cache tokens than the request reported', () => {
    const usage = toOpenAIModelUsage({
      promptTokens: 4583,
      completionTokens: 15,
      totalTokens: 4598,
      cachedTokens: 3945,
      cacheWriteTokens: 4580,
      reasoningTokens: 0,
    })

    expect(usage.input).toBe(0)
    expect(usage.cacheRead).toBe(3945)
    expect(usage.cacheWrites?.[0].tokens).toBe(4583 - 3945)
  })
})

describe('buildResponsesInputFromMessages', () => {
  it.each([null, ''])('preserves tool-only assistant messages with %s content', (content) => {
    expect(
      buildResponsesInputFromMessages([
        {
          role: 'assistant',
          content,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'lookup', arguments: '{"query":"a"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'found' },
      ])
    ).toEqual([
      { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{"query":"a"}' },
      { type: 'function_call_output', call_id: 'call-1', output: 'found' },
    ])
  })

  it('restores trusted native reasoning and call items once in their original order', () => {
    const message: Message = {
      role: 'assistant',
      content: 'portable duplicate',
      tool_calls: [
        { id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } },
      ],
    }
    const native = [
      { type: 'reasoning', id: 'rs_1', encrypted_content: 'encrypted', summary: [] },
      { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{}' },
    ]
    setNativeConversationMessage(message, {
      protocol: 'responses',
      providerId: 'openai',
      model: 'gpt-5.5',
      binding: 'binding',
      value: native,
    })
    expect(buildResponsesInputFromMessages([message])).toEqual(native)
  })

  it('does not accept native provider state supplied in message JSON', () => {
    const message = {
      role: 'assistant' as const,
      content: 'safe',
      native: [{ type: 'reasoning', encrypted_content: 'untrusted' }],
    }
    expect(buildResponsesInputFromMessages([message])).toEqual([
      { role: 'assistant', content: 'safe' },
    ])
  })

  it('should convert user message files to Responses multipart content', () => {
    const input = buildResponsesInputFromMessages([
      {
        role: 'user',
        content: 'Analyze this image',
        files: [
          {
            id: 'file-1',
            key: 'workspace/ws-1/example.png',
            name: 'example.png',
            url: '/api/files/serve/workspace%2Fws-1%2Fexample.png?context=workspace',
            size: 128,
            type: 'image/png',
            base64: 'iVBORw0KGgo=',
          },
        ],
      },
    ])

    expect(input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Analyze this image' },
          {
            type: 'input_image',
            image_url: 'data:image/png;base64,iVBORw0KGgo=',
            detail: 'auto',
          },
        ],
      },
    ])
  })

  it('preserves an ordinary document filename that collides with a configured secret', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'FILE_NAME', plaintext: 'report.pdf', encryptedValue: 'ciphertext' },
    ])

    const input = runWithProviderRuntimeContext({ resolvedSecretTraceRegistry: registry }, () =>
      buildResponsesInputFromMessages([
        {
          role: 'user',
          content: 'Analyze this document',
          files: [
            {
              id: 'file-1',
              key: 'workspace/ws-1/report.pdf',
              name: 'report.pdf',
              url: '/api/files/serve/workspace%2Fws-1%2Freport.pdf?context=workspace',
              size: 128,
              type: 'application/octet-stream',
              base64: 'cGRm',
            },
          ],
        },
      ])
    )

    expect(input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Analyze this document' },
          {
            type: 'input_file',
            filename: 'report.pdf',
            file_data: 'data:application/pdf;base64,cGRm',
          },
        ],
      },
    ])
  })
})

describe('convertToolsToResponses', () => {
  it.each(['wrapped', 'flat'] as const)(
    'preserves optional inputs on %s tool definitions without implicit strict normalization',
    (shape) => {
      const parameters = {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          folderPaths: { type: 'array', items: { type: 'string' } },
          offset: { type: 'number' },
        },
        required: ['fileId'],
      }
      const tool = { name: 'file_get_content', description: 'Read selected file text', parameters }
      const converted = convertToolsToResponses([
        shape === 'wrapped' ? { type: 'function', function: tool } : tool,
      ])

      expect(converted).toEqual([{ type: 'function', strict: false, ...tool }])
      expect(converted[0].parameters).toBe(parameters)
      expect(parameters.required).toEqual(['fileId'])
    }
  )
})

describe('createReadableStreamFromResponses', () => {
  function sseResponse(events: Array<{ event?: string; data: unknown }>): Response {
    const body = events
      .map((e) => {
        const lines = []
        if (e.event) lines.push(`event: ${e.event}`)
        lines.push(`data: ${JSON.stringify(e.data)}`)
        return `${lines.join('\n')}\n\n`
      })
      .join('')
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
  }

  async function collectEvents(
    stream: ReadableStream<AgentStreamEvent>
  ): Promise<AgentStreamEvent[]> {
    const events: AgentStreamEvent[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      events.push(value)
    }
    return events
  }

  it('emits reasoning summary deltas as thinking and output_text as final text', async () => {
    const onComplete = vi.fn()
    const response = sseResponse([
      {
        event: 'response.reasoning_summary_text.delta',
        data: { type: 'response.reasoning_summary_text.delta', delta: 'Summary thought. ' },
      },
      {
        event: 'response.output_text.delta',
        data: { type: 'response.output_text.delta', delta: 'Answer' },
      },
      {
        event: 'response.completed',
        data: {
          type: 'response.completed',
          response: {
            usage: { input_tokens: 4, output_tokens: 6 },
          },
        },
      },
    ])

    const events = await collectEvents(createReadableStreamFromResponses(response, onComplete))
    expect(events).toEqual([
      { type: 'thinking_delta', text: 'Summary thought. ' },
      { type: 'text_delta', text: 'Answer', turn: 'final' },
    ])
    expect(onComplete.mock.calls[0][0]).toBe('Answer')
    expect(onComplete.mock.calls[0][2]).toBe('Summary thought. ')
  })

  it('stays text-only when no reasoning summary events arrive', async () => {
    const response = sseResponse([
      {
        event: 'response.output_text.delta',
        data: { type: 'response.output_text.delta', delta: 'Hi' },
      },
      {
        event: 'response.completed',
        data: {
          type: 'response.completed',
          response: {
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
      },
    ])
    const events = await collectEvents(createReadableStreamFromResponses(response))
    expect(events).toEqual([{ type: 'text_delta', text: 'Hi', turn: 'final' }])
  })

  it('streams refusal text as the model answer', async () => {
    const response = sseResponse([
      {
        event: 'response.refusal.delta',
        data: { type: 'response.refusal.delta', delta: "I can't help with that." },
      },
      {
        event: 'response.completed',
        data: {
          type: 'response.completed',
          response: {
            usage: { input_tokens: 1, output_tokens: 5 },
          },
        },
      },
    ])

    const events = await collectEvents(createReadableStreamFromResponses(response))
    expect(events).toEqual([{ type: 'text_delta', text: "I can't help with that.", turn: 'final' }])
  })

  it('finalizes truncated text when max_output_tokens is the only incomplete condition', async () => {
    const onComplete = vi.fn()
    const response = sseResponse([
      {
        event: 'response.output_text.delta',
        data: { type: 'response.output_text.delta', delta: 'Truncated answer' },
      },
      {
        event: 'response.incomplete',
        data: {
          type: 'response.incomplete',
          response: {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [],
            usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 },
          },
        },
      },
    ])

    const events = await collectEvents(createReadableStreamFromResponses(response, onComplete))

    expect(events).toEqual([{ type: 'text_delta', text: 'Truncated answer', turn: 'final' }])
    expect(onComplete).toHaveBeenCalledWith(
      'Truncated answer',
      {
        promptTokens: 3,
        completionTokens: 5,
        totalTokens: 8,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      },
      undefined,
      expect.objectContaining({ status: 'incomplete', output: [] })
    )
  })

  it('rejects a max_output_tokens response with a partial function call', async () => {
    const response = sseResponse([
      {
        event: 'response.output_item.added',
        data: {
          type: 'response.output_item.added',
          item: {
            id: 'fc_partial',
            type: 'function_call',
            call_id: 'call_partial',
            name: 'lookup',
            arguments: '',
            status: 'in_progress',
          },
        },
      },
      {
        event: 'response.function_call_arguments.delta',
        data: {
          type: 'response.function_call_arguments.delta',
          item_id: 'fc_partial',
          output_index: 0,
          delta: '{"query":',
        },
      },
      {
        event: 'response.incomplete',
        data: {
          type: 'response.incomplete',
          response: {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [],
            usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 },
          },
        },
      },
    ])

    await expect(collectEvents(createReadableStreamFromResponses(response))).rejects.toThrow(
      'OpenAI Responses stream incomplete: max_output_tokens'
    )
  })

  it('continues rejecting non-token-cap incomplete responses', async () => {
    const response = sseResponse([
      {
        event: 'response.incomplete',
        data: {
          type: 'response.incomplete',
          response: {
            status: 'incomplete',
            incomplete_details: { reason: 'content_filter' },
            output: [],
          },
        },
      },
    ])

    await expect(collectEvents(createReadableStreamFromResponses(response))).rejects.toThrow(
      'OpenAI Responses stream incomplete: content_filter'
    )
  })
})
