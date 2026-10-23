/**
 * @vitest-environment node
 *
 * Wire contract with Kie's two request paths, as observed against the live API:
 * bearer auth on both, `stream` sent explicitly (Kie treats an absent flag as
 * true), Kie's own model slugs, and HTTP-200 error envelopes surfacing as errors.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { kieProvider } from '@/providers/kie'

const fetchMock = vi.fn<typeof fetch>()

const CLAUDE_MESSAGE = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text: 'pong' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 3, output_tokens: 1 },
}

const RESPONSES_RESULT = {
  id: 'resp_1',
  object: 'response',
  status: 'completed',
  output: [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'pong' }] },
  ],
  usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
}

function sentRequest(): { url: string; headers: Headers; body: Record<string, unknown> } {
  const [input, init] = fetchMock.mock.calls[0]
  return {
    url: String(input),
    headers: new Headers(init?.headers),
    body: JSON.parse(String(init?.body)),
  }
}

describe('kieProvider', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('sends Claude models to the Messages proxy with bearer auth and an explicit stream flag', async () => {
    fetchMock.mockResolvedValue(Response.json(CLAUDE_MESSAGE))

    const result = await kieProvider.executeRequest({
      model: 'kie/claude-opus-5-5',
      apiKey: 'kie-key',
      maxTokens: 1024,
      messages: [{ role: 'user', content: 'ping' }],
    })

    const { url, headers, body } = sentRequest()
    expect(url).toBe('https://api.kie.ai/claude/v1/messages')
    expect(headers.get('authorization')).toBe('Bearer kie-key')
    expect(headers.has('x-api-key')).toBe(false)
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.stream).toBe(false)
    expect(result).toMatchObject({ content: 'pong' })
  })

  it('parses a Claude message Kie returns without a content type', async () => {
    fetchMock.mockResolvedValue(
      new Response(new TextEncoder().encode(JSON.stringify(CLAUDE_MESSAGE)))
    )

    const result = await kieProvider.executeRequest({
      model: 'kie/claude-opus-5-5',
      apiKey: 'kie-key',
      maxTokens: 1024,
      messages: [{ role: 'user', content: 'ping' }],
    })

    expect(result).toMatchObject({ content: 'pong' })
  })

  it.each([
    ['none', false],
    ['enabled', true],
  ] as const)(
    'sends Sonnet thinking %s as the documented boolean flag',
    async (thinkingLevel, flag) => {
      fetchMock.mockResolvedValue(Response.json(CLAUDE_MESSAGE))
      await kieProvider.executeRequest({
        model: 'kie/claude-sonnet-5-5',
        apiKey: 'kie-key',
        maxTokens: 1024,
        thinkingLevel,
        messages: [{ role: 'user', content: 'ping' }],
      })
      const { body } = sentRequest()
      expect(body.thinkingFlag).toBe(flag)
      expect(body.thinking).toBeUndefined()
      expect(body.output_config).toBeUndefined()
    }
  )

  it('surfaces an HTTP 200 error envelope on the Claude route as an error', async () => {
    fetchMock.mockResolvedValue(Response.json({ code: 402, msg: 'Insufficient credits' }))

    await expect(
      kieProvider.executeRequest({
        model: 'kie/claude-opus-5-5',
        apiKey: 'kie-key',
        maxTokens: 1024,
        messages: [{ role: 'user', content: 'ping' }],
      })
    ).rejects.toThrow('Insufficient credits')
  })

  it('sends Responses models to their family endpoint with reasoning effort', async () => {
    fetchMock.mockResolvedValue(Response.json(RESPONSES_RESULT))

    const result = await kieProvider.executeRequest({
      model: 'kie/grok-4-6',
      apiKey: 'kie-key',
      reasoningEffort: 'high',
      messages: [{ role: 'user', content: 'ping' }],
    })

    const { url, headers, body } = sentRequest()
    expect(url).toBe('https://api.kie.ai/grok/v1/responses')
    expect(headers.get('authorization')).toBe('Bearer kie-key')
    expect(body.model).toBe('grok-4-6')
    expect(body.stream).toBe(false)
    expect(body.reasoning).toMatchObject({ effort: 'high' })
    expect(result).toMatchObject({ content: 'pong' })
  })

  it('downgrades a saved forced tool to auto for GPT 6.1 Sol', async () => {
    fetchMock.mockResolvedValue(Response.json(RESPONSES_RESULT))

    await kieProvider.executeRequest({
      model: 'kie/gpt-6-1-sol',
      apiKey: 'kie-key',
      messages: [{ role: 'user', content: 'Look this up' }],
      tools: [
        {
          id: 'lookup',
          name: 'lookup',
          description: 'Lookup',
          params: {},
          parameters: { type: 'object', properties: {}, required: [] },
          usageControl: 'force',
        },
      ],
    })

    const { body } = sentRequest()
    expect(body.tool_choice).toBe('auto')
    expect(body.tools).toMatchObject([{ type: 'function', name: 'lookup' }])
  })
})
