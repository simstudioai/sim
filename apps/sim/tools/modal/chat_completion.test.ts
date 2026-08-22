/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { modalChatCompletionTool } from '@/tools/modal/chat_completion'
import type { ModalChatCompletionParams } from '@/tools/modal/types'
import { MODAL_SHARED_INFERENCE_URL } from '@/tools/modal/utils'

const buildUrl = modalChatCompletionTool.request.url as (
  params: ModalChatCompletionParams
) => string
const buildBody = modalChatCompletionTool.request.body as (
  params: ModalChatCompletionParams
) => Record<string, unknown>
const transform = modalChatCompletionTool.transformResponse!

const baseParams: ModalChatCompletionParams = {
  model: 'my-endpoint.us-west.modal.direct',
  content: 'hello',
  tokenId: 'wk-1',
  tokenSecret: 'ws-2',
}

describe('modalChatCompletionTool endpoint resolution', () => {
  it('falls back to the shared inference host when no endpoint is given', () => {
    expect(buildUrl(baseParams)).toBe(`${MODAL_SHARED_INFERENCE_URL}/v1/chat/completions`)
  })

  it('treats a blank or whitespace endpoint the same as an omitted one', () => {
    expect(buildUrl({ ...baseParams, endpointUrl: '' })).toBe(
      `${MODAL_SHARED_INFERENCE_URL}/v1/chat/completions`
    )
    expect(buildUrl({ ...baseParams, endpointUrl: '   ' })).toBe(
      `${MODAL_SHARED_INFERENCE_URL}/v1/chat/completions`
    )
  })

  it('uses a dedicated endpoint when one is supplied', () => {
    expect(buildUrl({ ...baseParams, endpointUrl: 'https://mine.us-east.modal.direct' })).toBe(
      'https://mine.us-east.modal.direct/v1/chat/completions'
    )
  })
})

describe('modalChatCompletionTool body', () => {
  it('prepends the system prompt as a system message only when one is set', () => {
    expect(buildBody(baseParams).messages).toEqual([{ role: 'user', content: 'hello' }])
    expect(buildBody({ ...baseParams, systemPrompt: 'be terse' }).messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hello' },
    ])
  })

  it('maps the sampling controls onto their OpenAI wire names', () => {
    const body = buildBody({ ...baseParams, maxTokens: 256, temperature: 0, topP: 0.9 })
    expect(body).toMatchObject({ max_tokens: 256, temperature: 0, top_p: 0.9 })
  })

  it('omits sampling controls that were never set', () => {
    const body = buildBody(baseParams)
    expect(body).not.toHaveProperty('max_tokens')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
  })
})

describe('modalChatCompletionTool transformResponse', () => {
  it('extracts the completion, model, finish reason, and usage', async () => {
    const response = new Response(
      JSON.stringify({
        model: 'Qwen/Qwen3.5-4B',
        choices: [{ message: { content: 'hi there' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )

    await expect(transform(response, baseParams)).resolves.toMatchObject({
      success: true,
      output: {
        content: 'hi there',
        model: 'Qwen/Qwen3.5-4B',
        finishReason: 'stop',
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      },
    })
  })

  it('nulls usage an engine omitted instead of reporting zeros', async () => {
    const response = new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })

    await expect(transform(response, baseParams)).resolves.toMatchObject({
      output: {
        content: 'hi',
        model: 'my-endpoint.us-west.modal.direct',
        finishReason: null,
        usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
      },
    })
  })

  it('raises the endpoint error on a rejected proxy token', async () => {
    const response = new Response(JSON.stringify({ error: 'invalid proxy auth credentials' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
    await expect(transform(response, baseParams)).rejects.toThrow(
      'Modal chat completion failed (status 401): invalid proxy auth credentials'
    )
  })
})
