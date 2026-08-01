/**
 * @vitest-environment node
 */
import type OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import {
  buildResponsesInputFromMessages,
  parseResponsesUsage,
  toOpenAIModelUsage,
} from '@/providers/openai/utils'

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
})
