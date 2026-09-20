/**
 * @vitest-environment node
 */
import type OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { setNativeConversationMessage } from '@/providers/conversation-metadata'
import {
  buildResponsesInputFromMessages,
  convertToolsToResponses,
  parseResponsesUsage,
  toOpenAIModelUsage,
} from '@/providers/openai/utils'
import { runWithProviderRuntimeContext } from '@/providers/runtime-context'
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
