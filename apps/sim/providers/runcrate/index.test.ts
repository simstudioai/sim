import { collectStream } from '@sim/testing/helpers/async'
import { jsonResponse } from '@sim/testing/helpers/http'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersTraceEnrichmentMock } from '@sim/testing/mocks/providers-trace-enrichment.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamingExecution } from '@/executor/types'
import { runcrateProvider } from '@/providers/runcrate'
import type { ProviderResponse, ProviderToolConfig } from '@/providers/types'

vi.mock('@/providers', () => providersMock)
vi.mock('@/providers/trace-enrichment', () => providersTraceEnrichmentMock)

const MODEL = 'runcrate/Qwen/Qwen3-235B-A22B-Instruct-2507'
const WIRE_MODEL = 'Qwen/Qwen3-235B-A22B-Instruct-2507'
const REQUEST = {
  model: MODEL,
  apiKey: 'runcrate-test-key',
  messages: [{ role: 'user' as const, content: 'Return the answer.' }],
}

function completion(content: string) {
  return {
    id: 'chatcmpl-runcrate',
    object: 'chat.completion',
    created: 1,
    model: WIRE_MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }
}

describe('Runcrate Chat Completions wire contract', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it.each(['RUNCRATE/Qwen/Qwen3-235B-A22B-Instruct-2507', MODEL.toLowerCase()])(
    'authenticates at Runcrate and preserves catalog identity for %s',
    async (selectedModel) => {
      vi.mocked(fetch).mockImplementationOnce(async (url, init) => {
        expect(String(url)).toBe('https://api.runcrate.ai/v1/chat/completions')
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer runcrate-test-key')
        const payload = JSON.parse(String(init?.body))
        expect(payload.model).toBe(WIRE_MODEL)
        return jsonResponse(completion('42'))
      })
      const result = (await runcrateProvider.executeRequest({
        ...REQUEST,
        model: selectedModel,
      })) as ProviderResponse
      expect(result.model).toBe(selectedModel)
      expect(result.tokens).toEqual({ input: 10, output: 5, total: 15 })
    }
  )

  it('sends the strict JSON schema envelope', async () => {
    const schema = {
      type: 'object',
      properties: { answer: { type: 'number' } },
      required: ['answer'],
    }
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      const payload = JSON.parse(String(init?.body))
      expect(payload.response_format).toEqual({
        type: 'json_schema',
        json_schema: { name: 'answer', schema, strict: true },
      })
      return jsonResponse(completion('{"answer":42}'))
    })
    const result = (await runcrateProvider.executeRequest({
      ...REQUEST,
      responseFormat: { name: 'answer', schema },
    })) as ProviderResponse
    expect(JSON.parse(result.content)).toEqual({ answer: 42 })
  })

  it.each([
    { model: MODEL, forced: false },
    { model: 'runcrate/meta-llama/Llama-3.3-70B-Instruct-Turbo', forced: false },
    { model: 'runcrate/google/gemma-3-27b-it', forced: true },
    { model: 'runcrate/deepseek-ai/DeepSeek-V3.2', forced: true },
  ])('honors the forced-tool wire contract for $model', async (scenario) => {
    const tools: ProviderToolConfig[] = [
      {
        id: 'http_request',
        description: 'Fetch a URL',
        params: {},
        parameters: { type: 'object', properties: {}, required: [] },
        usageControl: 'force',
      },
      {
        id: 'disabled_tool',
        description: 'Disabled tool',
        params: {},
        parameters: { type: 'object', properties: {}, required: [] },
        usageControl: 'none',
      },
    ]
    const payloads: Array<{
      tool_choice: unknown
      tools: Array<{ function: { name: string } }>
    }> = []
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)))
      return jsonResponse(completion('42'))
    })
    const result = (await runcrateProvider.executeRequest({
      ...REQUEST,
      model: scenario.model,
      tools,
    })) as ProviderResponse
    expect(payloads[0]?.tool_choice).toEqual(
      scenario.forced ? { type: 'function', function: { name: 'http_request' } } : 'auto'
    )
    expect(payloads[0]?.tools.map((tool) => tool.function.name)).toEqual(['http_request'])
    expect(result.content).toBe('42')
    expect(tools[0].usageControl).toBe('force')
    expect(tools[1].usageControl).toBe('none')
  })

  it('decodes SSE reasoning and usage while retaining Runcrate pricing', async () => {
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      const payload = JSON.parse(String(init?.body))
      expect(payload.stream_options).toEqual({ include_usage: true })
      const chunks = [
        { choices: [{ index: 0, delta: { reasoning_content: 'Compute.' } }] },
        { choices: [{ index: 0, delta: { content: '42' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      ]
      return new Response(
        `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
        {
          headers: { 'content-type': 'text/event-stream' },
        }
      )
    })
    const result = (await runcrateProvider.executeRequest({
      ...REQUEST,
      stream: true,
    })) as StreamingExecution
    const chunks = await collectStream(result.stream)
    const events = JSON.stringify(chunks)
    expect(events).toContain('Compute.')
    const output = await result.execution
    expect(output.output.content).toBe('42')
    expect(output.output.tokens).toEqual({ input: 10, output: 5, total: 15 })
    expect(output.output.cost?.total).toBeCloseTo(0.00000383, 8)
  })

  it('rejects missing credentials before any outbound call', async () => {
    await expect(
      runcrateProvider.executeRequest({ ...REQUEST, apiKey: undefined })
    ).rejects.toThrow('API key is required')
    expect(fetch).not.toHaveBeenCalled()
  })
})
