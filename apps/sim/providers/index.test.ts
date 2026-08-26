/**
 * @vitest-environment node
 */
import { envFlagsMockFns, resetEnvFlagsMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAttachLargeFileRemoteUrls,
  mockGetApiKeyWithBYOK,
  mockExecuteRequest,
  mockFilterModelSafeWorkspaceFileAttachments,
  mockExecuteTool,
  mockUploadLargeFilesToProvider,
} = vi.hoisted(() => ({
  mockAttachLargeFileRemoteUrls: vi.fn(),
  mockGetApiKeyWithBYOK: vi.fn(),
  mockExecuteRequest: vi.fn(),
  mockFilterModelSafeWorkspaceFileAttachments: vi.fn(async (attachments: unknown[]) => attachments),
  mockExecuteTool: vi.fn(async () => ({ success: true, output: {} })),
  mockUploadLargeFilesToProvider: vi.fn(),
}))

vi.mock('@/lib/api-key/byok', () => ({
  getApiKeyWithBYOK: (...args: unknown[]) => mockGetApiKeyWithBYOK(...args),
}))

vi.mock('@/providers/registry', () => ({
  getProviderExecutor: vi.fn().mockResolvedValue({
    executeRequest: (...args: unknown[]) => mockExecuteRequest(...args),
  }),
}))

vi.mock('@/providers/file-attachments.server', () => ({
  attachLargeFileRemoteUrls: (...args: unknown[]) => mockAttachLargeFileRemoteUrls(...args),
  canUseProviderLargeFilePath: () => true,
  uploadLargeFilesToProvider: (...args: unknown[]) => mockUploadLargeFilesToProvider(...args),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  filterModelSafeWorkspaceFileAttachments: (...args: unknown[]) =>
    mockFilterModelSafeWorkspaceFileAttachments(...args),
}))

vi.mock('@/tools', () => ({
  executeTool: (...args: unknown[]) => mockExecuteTool(...args),
}))

import type { NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { executeProviderRequest } from '@/providers'
import { executeProviderTool } from '@/providers/runtime-context'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { ProviderResponse, ProviderToolConfig } from '@/providers/types'

const HOSTED_RATE_INPUT_COST = 0.340285
const HOSTED_RATE_OUTPUT_COST = 0.0387
const HOSTED_RATE_TOTAL_COST = HOSTED_RATE_INPUT_COST + HOSTED_RATE_OUTPUT_COST
const ARBITRARY_SCHEMA_CONTROL_KEYS = [
  '$schema',
  'format',
  'contentEncoding',
  'contentMediaType',
  'type',
] as const

function makeAnthropicResponse(): ProviderResponse {
  // Mirrors the shape produced by Anthropic core for a real BYOK execution
  // (gross hosted-rate cost was written into time-segment cost by the trace
  // enricher even though the block-level cost should be zeroed for BYOK).
  return {
    content: 'hello',
    model: 'claude-opus-4-6',
    tokens: { input: 68057, output: 1548, total: 69605 },
    cost: {
      input: HOSTED_RATE_INPUT_COST,
      output: HOSTED_RATE_OUTPUT_COST,
      total: HOSTED_RATE_TOTAL_COST,
      pricing: { input: 5.0, output: 25.0, updatedAt: '2026-04-01' },
    },
    timing: {
      startTime: '2026-04-30T21:27:37.878Z',
      endTime: '2026-04-30T21:28:19.836Z',
      duration: 41958,
      timeSegments: [
        {
          type: 'model',
          name: 'claude-opus-4-6',
          startTime: 1777584457878,
          endTime: 1777584499836,
          duration: 41958,
          tokens: { input: 68057, output: 1548, total: 69605 },
          cost: {
            input: HOSTED_RATE_INPUT_COST,
            output: HOSTED_RATE_OUTPUT_COST,
            total: HOSTED_RATE_TOTAL_COST,
          },
        },
      ],
    },
  }
}

function makeProviderTool(id: string, credential: string): ProviderToolConfig {
  return {
    id,
    description: id,
    params: { oauthCredential: credential },
    parameters: { type: 'object', properties: {}, required: [] },
  }
}

describe('executeProviderRequest — tool identities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends unique opaque ids and projects provider aliases out of the response', async () => {
    const tools = [
      makeProviderTool('gmail_send', 'credential-a'),
      makeProviderTool('gmail_send', 'credential-b'),
    ]
    mockExecuteRequest.mockImplementationOnce(async (request) => {
      const alias = request.tools[1].id
      expect(request.tools.map((tool: ProviderToolConfig) => tool.id)).toEqual([
        'gmail_send',
        'gmail_send__sim_2',
      ])
      expect(alias).not.toContain('credential-b')
      return {
        content: 'sent',
        model: 'test-model',
        toolCalls: [{ name: alias, arguments: {} }],
        timing: {
          startTime: 'start',
          endTime: 'end',
          duration: 1,
          timeSegments: [{ type: 'tool', name: alias, startTime: 0, endTime: 1, duration: 1 }],
        },
      }
    })

    const response = (await executeProviderRequest('anthropic', {
      model: 'test-model',
      tools,
    })) as ProviderResponse

    expect(response.toolCalls?.[0].name).toBe('gmail_send')
    expect(response.timing?.timeSegments?.[0].name).toBe('gmail_send')
    expect(tools[1].params.oauthCredential).toBe('credential-b')
  })

  it('keeps the alias map active while a streaming provider executes the selected instance', async () => {
    const tools = [
      makeProviderTool('gmail_send', 'credential-a'),
      makeProviderTool('gmail_send', 'credential-b'),
    ]
    mockExecuteRequest.mockImplementationOnce(async (request) => {
      const selected = request.tools[1] as ProviderToolConfig
      const output: NormalizedBlockOutput = {
        toolCalls: { list: [], count: 0 },
        providerTiming: { startTime: 'start', endTime: 'end', duration: 0, timeSegments: [] },
      }
      return {
        streamFormat: 'agent-events-v1',
        stream: new ReadableStream<AgentStreamEvent>({
          async pull(controller) {
            await executeProviderTool(selected.id, selected.params)
            output.toolCalls = { list: [{ name: selected.id }], count: 1 }
            controller.enqueue({ type: 'tool_call_start', id: 'call-1', name: selected.id })
            controller.close()
          },
        }),
        execution: { success: true, output },
      }
    })

    const response = await executeProviderRequest('anthropic', {
      model: 'test-model',
      tools,
    })
    expect(response).not.toBeInstanceOf(ReadableStream)
    expect(response).toHaveProperty('stream')
    const streaming = response as StreamingExecution
    const reader = (streaming.stream as ReadableStream<AgentStreamEvent>).getReader()
    const event = await reader.read()
    await reader.read()

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'gmail_send',
      { oauthCredential: 'credential-b' },
      expect.any(Object)
    )
    expect(event.value).toEqual({ type: 'tool_call_start', id: 'call-1', name: 'gmail_send' })
    expect(streaming.execution.output.toolCalls?.list[0].name).toBe('gmail_send')
  })
})

describe('executeProviderRequest — BYOK regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('zeroes block-level model cost for BYOK callers (existing behavior)', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-byok', isBYOK: true })
    mockExecuteRequest.mockResolvedValue(makeAnthropicResponse())

    const result = (await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
    })) as ProviderResponse

    expect(result.cost?.total).toBe(0)
    expect(result.cost?.input).toBe(0)
    expect(result.cost?.output).toBe(0)
  })

  it('zeroes per-segment model cost for BYOK callers so trace aggregation does not re-charge', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-byok', isBYOK: true })
    mockExecuteRequest.mockResolvedValue(makeAnthropicResponse())

    const result = (await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
    })) as ProviderResponse

    const segment = result.timing?.timeSegments?.[0]
    expect(segment?.cost).toBeDefined()
    expect(segment?.cost?.input).toBe(0)
    expect(segment?.cost?.output).toBe(0)
    expect(segment?.cost?.total).toBe(0)
    // Tokens must be preserved so the UI still displays usage even when
    // BYOK callers are not billed.
    expect(segment?.tokens?.input).toBe(68057)
    expect(segment?.tokens?.output).toBe(1548)
  })

  it('does not zero per-segment cost for non-BYOK hosted callers', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-rotating', isBYOK: false })
    mockExecuteRequest.mockResolvedValue(makeAnthropicResponse())

    const result = (await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
    })) as ProviderResponse

    const segment = result.timing?.timeSegments?.[0]
    expect(segment?.cost?.total).toBeCloseTo(HOSTED_RATE_TOTAL_COST, 6)
  })

  /**
   * Provider cost is now preferred over recomputation, because only the
   * provider knows its cache tiers. Tool cost is the hazard in that branch:
   * `executeProviderRequest` re-derives it from `toolResults`, so a provider
   * that folded it into its own total must not have it counted twice.
   */
  it('counts a provider-folded tool cost exactly once', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-rotating', isBYOK: false })
    mockExecuteRequest.mockResolvedValue({
      content: 'hi',
      model: 'claude-opus-4-6',
      tokens: { input: 100, output: 50, total: 150 },
      cost: {
        input: 0.0005,
        output: 0.00125,
        total: 0.00675,
        toolCost: 0.005,
        pricing: { input: 5.0, output: 25.0, updatedAt: '2026-04-01' },
      },
      toolResults: [{ cost: { total: 0.005 } }],
    } as ProviderResponse)

    const result = (await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
    })) as ProviderResponse

    expect(result.cost?.toolCost).toBeCloseTo(0.005, 8)
    expect(result.cost?.total).toBeCloseTo(0.00675, 8)
  })

  /**
   * Gemini hands the same cost object to its response and its model segment.
   * Adding tool cost by mutation would charge it to the segment too.
   */
  it('does not leak tool cost into a segment sharing the provider cost object', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-rotating', isBYOK: false })
    envFlagsMockFns.getCostMultiplier.mockReturnValue(1)
    const sharedCost = {
      input: 0.0005,
      output: 0.00125,
      total: 0.00175,
      pricing: { input: 5.0, output: 25.0, updatedAt: '2026-04-01' },
    }
    mockExecuteRequest.mockResolvedValue({
      content: 'hi',
      model: 'claude-opus-4-6',
      tokens: { input: 100, output: 50, total: 150 },
      cost: sharedCost,
      toolResults: [{ cost: { total: 0.004 } }],
      timing: {
        startTime: '2026-04-30T21:27:37.878Z',
        endTime: '2026-04-30T21:27:38.000Z',
        duration: 122,
        timeSegments: [
          {
            type: 'model',
            name: 'claude-opus-4-6',
            startTime: 1777584457878,
            endTime: 1777584457940,
            duration: 62,
            cost: sharedCost,
          },
        ],
      },
    } as ProviderResponse)

    const result = (await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
    })) as ProviderResponse

    expect(result.cost?.total).toBeCloseTo(0.00575, 8)
    expect(result.timing?.timeSegments?.[0]?.cost?.total).toBeCloseTo(0.00175, 8)
  })

  it('keeps the provider cost rather than recomputing it from tokens', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-rotating', isBYOK: false })
    // Cache-tier pricing this layer cannot rebuild from `tokens` alone.
    mockExecuteRequest.mockResolvedValue({
      content: 'hi',
      model: 'claude-opus-4-6',
      tokens: { input: 100, output: 50, total: 150, cacheRead: 900, cacheWrite: 400 },
      cost: {
        input: 0.0123,
        output: 0.00125,
        total: 0.01355,
        pricing: { input: 5.0, output: 25.0, updatedAt: '2026-04-01' },
      },
    } as ProviderResponse)

    const result = (await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
    })) as ProviderResponse

    expect(result.cost?.input).toBeCloseTo(0.0123, 8)
    expect(result.cost?.total).toBeCloseTo(0.01355, 8)
  })

  it('preserves tool segment cost (BYOK does not suppress tool charges)', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-byok', isBYOK: true })
    const responseWithToolSegment: ProviderResponse = {
      content: 'hi',
      model: 'claude-opus-4-6',
      tokens: { input: 100, output: 50, total: 150 },
      cost: {
        input: 0.0005,
        output: 0.00125,
        total: 0.00175,
        pricing: { input: 5.0, output: 25.0, updatedAt: '2026-04-01' },
      },
      timing: {
        startTime: '2026-04-30T21:27:37.878Z',
        endTime: '2026-04-30T21:27:38.000Z',
        duration: 122,
        timeSegments: [
          {
            type: 'model',
            name: 'claude-opus-4-6',
            startTime: 1777584457878,
            endTime: 1777584457940,
            duration: 62,
            cost: { input: 0.0005, output: 0.00125, total: 0.00175 },
          },
          {
            type: 'tool',
            name: 'firecrawl_scrape',
            startTime: 1777584457940,
            endTime: 1777584458000,
            duration: 60,
            cost: { total: 0.01 },
          },
        ],
      },
    }
    mockExecuteRequest.mockResolvedValue(responseWithToolSegment)

    const result = (await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
    })) as ProviderResponse

    const [model, tool] = result.timing!.timeSegments!
    expect(model.cost?.total).toBe(0)
    expect(tool.type).toBe('tool')
    expect(tool.cost?.total).toBe(0.01)
  })

  it('zeroes per-segment cost on streaming responses for BYOK callers', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-byok', isBYOK: true })
    const segments = [
      {
        type: 'model' as const,
        name: 'claude-opus-4-6',
        startTime: 1777584457878,
        endTime: 1777584499836,
        duration: 41958,
        cost: {
          input: HOSTED_RATE_INPUT_COST,
          output: HOSTED_RATE_OUTPUT_COST,
          total: HOSTED_RATE_TOTAL_COST,
        },
      },
    ]
    const streamingResponse = {
      stream: new ReadableStream(),
      execution: {
        success: true,
        output: {
          content: '',
          model: 'claude-opus-4-6',
          tokens: { input: 0, output: 0, total: 0 },
          providerTiming: {
            startTime: '2026-04-30T21:27:37.878Z',
            endTime: '2026-04-30T21:28:19.836Z',
            duration: 41958,
            timeSegments: segments,
          },
          cost: {
            input: HOSTED_RATE_INPUT_COST,
            output: HOSTED_RATE_OUTPUT_COST,
            total: HOSTED_RATE_TOTAL_COST,
          },
        },
        logs: [],
      },
    }
    mockExecuteRequest.mockResolvedValue(streamingResponse)

    await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
      stream: true,
    })

    expect(segments[0].cost.total).toBe(0)
    expect(segments[0].cost.input).toBe(0)
    expect(segments[0].cost.output).toBe(0)
  })
})

/**
 * Streaming and non-streaming must charge identically. Providers price tokens
 * inside the stream drain without knowing key provenance or the margin, so the
 * shared policy is installed on the live output before the stream is returned.
 */
describe('executeProviderRequest — streaming cost policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-rotating', isBYOK: false })
  })

  afterEach(resetEnvFlagsMock)

  function makeStreamingExecution(initialCost?: Record<string, number>) {
    return {
      stream: new ReadableStream(),
      execution: {
        success: true,
        output: {
          content: '',
          model: 'claude-opus-4-6',
          tokens: { input: 0, output: 0, total: 0 },
          ...(initialCost ? { cost: initialCost } : {}),
        },
        logs: [],
      },
    }
  }

  it('applies the cost multiplier to cost the provider writes while streaming', async () => {
    envFlagsMockFns.getCostMultiplier.mockReturnValue(2)
    const streaming = makeStreamingExecution()
    mockExecuteRequest.mockResolvedValue(streaming)

    await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
      stream: true,
    })

    streaming.execution.output.cost = { input: 1, output: 2, total: 3 }

    expect(streaming.execution.output.cost).toMatchObject({ input: 2, output: 4, total: 6 })
  })

  it('does not charge for models Sim does not host', async () => {
    const streaming = {
      stream: new ReadableStream(),
      execution: {
        success: true,
        output: {
          content: '',
          model: 'llama-3.3-70b-versatile',
          tokens: { input: 0, output: 0, total: 0 },
        },
        logs: [],
      },
    }
    mockExecuteRequest.mockResolvedValue(streaming)

    await executeProviderRequest('groq', {
      model: 'llama-3.3-70b-versatile',
      workspaceId: 'ws-1',
      stream: true,
    })

    streaming.execution.output.cost = { input: 0.5, output: 1.5, total: 2 }

    expect(streaming.execution.output.cost).toMatchObject({ input: 0, output: 0, total: 0 })
  })

  it('keeps tool cost from a settled stream that priced its tools before returning', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-byok', isBYOK: true })
    const streaming = makeStreamingExecution({
      input: 0.01,
      output: 0.02,
      total: 0.035,
      toolCost: 0.005,
    })
    mockExecuteRequest.mockResolvedValue(streaming)

    await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
      stream: true,
    })

    expect(streaming.execution.output.cost).toMatchObject({
      input: 0,
      output: 0,
      total: 0.005,
      toolCost: 0.005,
    })
  })
})

describe('executeProviderRequest — caller-prepared model input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteRequest.mockResolvedValue({
      content: 'ok',
      model: 'test-model',
      tokens: { input: 1, output: 1, total: 2 },
    } as ProviderResponse)
  })

  it('does not rescan or rewrite a caller-prepared provider request', async () => {
    const secret = 'quoted"secret\\with\nnewline'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', secret)

    await executeProviderRequest(
      'anthropic',
      {
        model: 'test-model',
        apiKey: secret,
        systemPrompt: `system ${secret}`,
        context: `context ${secret}`,
        messages: [
          {
            role: 'user',
            content: `message ${secret} __var_TOKEN`,
            files: [
              {
                id: 'file-1',
                name: `${secret}.txt`,
                url: '/file',
                size: 4,
                type: 'text/plain',
                key: 'file-key',
                base64: 'c2FmZQ==',
              },
            ],
          },
          {
            role: 'assistant',
            content: null,
            name: 'assistant-safe',
            function_call: {
              name: 'legacy-safe',
              arguments: JSON.stringify({ value: secret }),
            },
            tool_calls: [
              {
                id: `call-${secret}`,
                type: 'function',
                function: {
                  name: 'tool-safe',
                  arguments: JSON.stringify({ value: secret }),
                },
              },
            ],
            tool_call_id: `result-${secret}`,
          },
        ],
        tools: [
          {
            id: 'custom_tool',
            name: 'Safe Tool',
            description: `Description ${secret}`,
            params: { runtimeSecret: secret },
            parameters: {
              type: 'object',
              properties: { value: { type: 'string', description: secret } },
              required: [],
            },
          },
        ],
        responseFormat: {
          name: 'safe_result',
          schema: {
            type: 'object',
            properties: { value: { type: 'string', description: secret } },
          },
        },
        environmentVariables: { TOKEN: secret },
        workflowVariables: { raw: secret },
      },
      { resolvedSecretTraceRegistry: registry }
    )

    const sent = mockExecuteRequest.mock.calls[0][0]
    expect(sent.systemPrompt).toBe(`system ${secret}`)
    expect(sent.context).toBe(`context ${secret}`)
    expect(sent.messages[0].content).toBe(`message ${secret} __var_TOKEN`)
    expect(sent.messages[0].files[0]).toMatchObject({
      name: `${secret}.txt`,
      base64: 'c2FmZQ==',
    })
    expect(sent.messages[1]).toMatchObject({
      name: 'assistant-safe',
      function_call: {
        name: 'legacy-safe',
        arguments: JSON.stringify({ value: secret }),
      },
      tool_calls: [
        {
          id: `call-${secret}`,
          function: {
            name: 'tool-safe',
            arguments: JSON.stringify({ value: secret }),
          },
        },
      ],
      tool_call_id: `result-${secret}`,
    })
    expect(sent.tools[0]).toMatchObject({
      name: 'Safe Tool',
      description: `Description ${secret}`,
      params: { runtimeSecret: secret },
      parameters: {
        properties: { value: { description: secret } },
      },
    })
    expect(sent.responseFormat).toMatchObject({
      name: 'safe_result',
      schema: {
        properties: { value: { description: secret } },
      },
    })
    expect(sent.apiKey).toBe(secret)
    expect(sent.environmentVariables).toEqual({ TOKEN: secret })
    expect(sent.workflowVariables).toEqual({ raw: secret })
    expect(JSON.stringify(sent)).toContain('__var_TOKEN')
  })

  it('does not infer provenance from a dormant request environment map', async () => {
    const registry = new ResolvedSecretTraceRegistry()

    await executeProviderRequest(
      'anthropic',
      {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Use runtime-secret' }],
        environmentVariables: { RUNTIME_TOKEN: 'runtime-secret' },
      },
      { resolvedSecretTraceRegistry: registry }
    )

    expect(mockExecuteRequest.mock.calls[0][0].messages[0].content).toBe('Use runtime-secret')
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('does not let dormant low-entropy secrets invalidate ordinary prompts or JSON Schema', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TYPE_SECRET', plaintext: 'string', encryptedValue: 'encrypted-type' },
      { name: 'BOOLEAN_SECRET', plaintext: 'true', encryptedValue: 'encrypted-boolean' },
    ])

    await executeProviderRequest(
      'openai',
      {
        model: 'test-model',
        systemPrompt: 'Return a string when the statement is true.',
        responseFormat: {
          name: 'ordinary_response',
          schema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
            additionalProperties: false,
          },
        },
      },
      { resolvedSecretTraceRegistry: registry }
    )

    expect(mockExecuteRequest.mock.calls[0][0]).toMatchObject({
      systemPrompt: 'Return a string when the statement is true.',
      responseFormat: {
        schema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
          additionalProperties: false,
        },
      },
    })
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('does not carry an earlier active secret into unrelated public schema grammar', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TYPE_SECRET', plaintext: 'string', encryptedValue: 'encrypted-type' },
    ])
    registry.recordResolved('TYPE_SECRET', 'string')

    await executeProviderRequest(
      'openai',
      {
        model: 'test-model',
        systemPrompt: 'Choose a loading status',
        responseFormat: {
          name: 'loading_status',
          schema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
            additionalProperties: false,
          },
        },
      },
      { resolvedSecretTraceRegistry: registry }
    )

    expect(mockExecuteRequest.mock.calls.at(-1)?.[0]).toMatchObject({
      systemPrompt: 'Choose a loading status',
      responseFormat: {
        name: 'loading_status',
        schema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
          additionalProperties: false,
        },
      },
    })
  })

  it('preserves public prompt and schema text that equals an active secret', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'SCHEMA_KEY', plaintext: 'messages', encryptedValue: 'encrypted-schema-key' },
    ])
    registry.recordResolved('SCHEMA_KEY', 'messages')

    await executeProviderRequest(
      'openai',
      {
        model: 'test-model',
        systemPrompt: 'Choose loading messages',
        messages: [{ role: 'user', content: 'Select messages for this request' }],
        responseFormat: {
          name: 'loading_messages',
          schema: {
            type: 'object',
            properties: { messages: { type: 'array', items: { type: 'string' } } },
            required: ['messages'],
            additionalProperties: false,
          },
        },
      },
      { resolvedSecretTraceRegistry: registry }
    )

    const sent = mockExecuteRequest.mock.calls.at(-1)?.[0]
    expect(sent).toMatchObject({
      systemPrompt: 'Choose loading messages',
      messages: [{ role: 'user', content: 'Select messages for this request' }],
      responseFormat: {
        name: 'loading_messages',
        schema: {
          properties: { messages: { type: 'array', items: { type: 'string' } } },
        },
      },
    })
  })

  it('preserves response-format control text without inventing replacement names', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'UNDERSCORE', plaintext: '_', encryptedValue: 'encrypted-underscore' },
    ])
    registry.recordResolved('UNDERSCORE', '_')

    await executeProviderRequest(
      'openai',
      {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Continue safely' }],
        responseFormat: {
          name: 'unsafe_name',
          schema: { type: 'object', properties: {} },
        },
      },
      { resolvedSecretTraceRegistry: registry }
    )

    expect(mockExecuteRequest.mock.calls.at(-1)?.[0]).toMatchObject({
      messages: [{ role: 'user', content: 'Continue safely' }],
      responseFormat: {
        name: 'unsafe_name',
        schema: { type: 'object', properties: {} },
      },
    })
  })

  it('leaves provider schema validation to the provider adapter', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    const oversizedSchema = { allOf: new Array(100_001) }

    for (const schema of [{ properties: { field: 'not-a-schema' } }, oversizedSchema]) {
      mockExecuteRequest.mockClear()
      await executeProviderRequest(
        'openai',
        {
          model: 'test-model',
          messages: [{ role: 'user', content: 'Continue safely' }],
          tools: [
            {
              id: 'unsafe_tool',
              name: 'Unsafe tool',
              description: 'Invalid optional schema',
              params: {},
              parameters: schema,
            },
          ],
          responseFormat: { name: 'unsafe_response', schema },
        },
        { resolvedSecretTraceRegistry: registry }
      )

      expect(mockExecuteRequest.mock.calls.at(-1)?.[0]).toMatchObject({
        messages: [{ role: 'user', content: 'Continue safely' }],
        tools: [expect.objectContaining({ id: 'unsafe_tool', parameters: schema })],
        responseFormat: { name: 'unsafe_response', schema },
      })
    }
  })

  it('keeps attachment metadata raw through storage resolution and provider upload', async () => {
    const secret = 'attachment-secret'
    const rawStorageKey = `workspace/raw-${secret}/document.pdf`
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', secret)

    await executeProviderRequest(
      'openai',
      {
        model: 'test-model',
        messages: [
          {
            role: 'user',
            content: 'Review this attachment',
            files: [
              {
                id: 'file-1',
                name: `report-${secret}.pdf`,
                url: '/file',
                size: 20 * 1024 * 1024,
                type: 'application/pdf',
                key: rawStorageKey,
              },
            ],
          },
        ],
      },
      { resolvedSecretTraceRegistry: registry }
    )

    const attachmentRequest = mockAttachLargeFileRemoteUrls.mock.calls[0][0]
    const uploadRequest = mockUploadLargeFilesToProvider.mock.calls[0][0]
    expect(attachmentRequest.messages[0].files[0]).toMatchObject({
      name: `report-${secret}.pdf`,
      key: rawStorageKey,
    })
    expect(uploadRequest).toBe(attachmentRequest)
    expect(mockExecuteRequest.mock.calls[0][0].messages[0].files[0]).toMatchObject({
      name: `report-${secret}.pdf`,
      key: rawStorageKey,
    })
  })

  it('omits only unsafe durable files before any provider attachment processing', async () => {
    const unsafe = {
      id: 'wf-unsafe',
      name: 'unsafe.txt',
      url: '/unsafe',
      size: 10,
      type: 'text/plain',
      key: 'workspace/ws-1/unsafe.txt',
    }
    const safe = {
      id: 'wf-safe',
      name: 'safe.txt',
      url: '/safe',
      size: 10,
      type: 'text/plain',
      key: 'workspace/ws-1/safe.txt',
    }
    mockFilterModelSafeWorkspaceFileAttachments.mockResolvedValueOnce([safe])

    await executeProviderRequest('openai', {
      model: 'test-model',
      workspaceId: 'ws-1',
      messages: [{ role: 'user', content: 'Review files', files: [unsafe, safe] }],
    })

    expect(mockAttachLargeFileRemoteUrls.mock.calls[0][0].messages[0].files).toEqual([safe])
    expect(mockUploadLargeFilesToProvider.mock.calls[0][0].messages[0].files).toEqual([safe])
    expect(mockExecuteRequest.mock.calls[0][0].messages[0].files).toEqual([safe])
  })

  it('fails explicitly when file provenance lookup is unavailable', async () => {
    mockFilterModelSafeWorkspaceFileAttachments.mockRejectedValueOnce(new Error('db unavailable'))

    await expect(
      executeProviderRequest('openai', {
        model: 'test-model',
        workspaceId: 'ws-1',
        messages: [
          {
            role: 'user',
            content: 'Review the file',
            files: [
              {
                id: 'wf-file',
                name: 'file.txt',
                url: '/file',
                size: 10,
                type: 'text/plain',
                key: 'workspace/ws-1/file.txt',
              },
            ],
          },
        ],
      })
    ).rejects.toThrow('File attachments could not be verified for model use')

    expect(mockAttachLargeFileRemoteUrls).not.toHaveBeenCalled()
    expect(mockUploadLargeFilesToProvider).not.toHaveBeenCalled()
    expect(mockExecuteRequest).not.toHaveBeenCalled()
  })

  it('preserves provider-generated JSON arguments and attachment metadata byte-for-byte', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'TOKEN', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'TOKEN')

    await executeProviderRequest(
      'openai',
      {
        model: 'test-model',
        messages: [
          {
            role: 'assistant',
            content: 'TOKEN',
            function_call: {
              name: 'legacy-safe',
              arguments: JSON.stringify({ value: 'TOKEN' }),
            },
            tool_calls: [
              {
                id: 'call-safe',
                type: 'function',
                function: {
                  name: 'tool-safe',
                  arguments: JSON.stringify({ value: 'TOKEN' }),
                },
              },
            ],
            files: [
              {
                id: 'file-safe',
                name: 'TOKEN.txt',
                url: '/file',
                size: 4,
                type: 'text/plain',
                key: 'file-key',
                context: 'Context TOKEN',
              },
            ],
          },
        ],
      },
      { resolvedSecretTraceRegistry: registry }
    )

    const sent = mockExecuteRequest.mock.calls.at(-1)?.[0]
    expect(sent.messages[0]).toMatchObject({
      content: 'TOKEN',
      function_call: { arguments: JSON.stringify({ value: 'TOKEN' }) },
      tool_calls: [
        {
          function: { arguments: JSON.stringify({ value: 'TOKEN' }) },
        },
      ],
      files: [
        {
          name: 'TOKEN.txt',
          context: 'Context TOKEN',
        },
      ],
    })
    expect(sent.messages[0].function_call.arguments).toBe(JSON.stringify({ value: 'TOKEN' }))
    expect(sent.messages[0].tool_calls[0].function.arguments).toBe(
      JSON.stringify({ value: 'TOKEN' })
    )
  })

  it.each(['123', 'true'])(
    'never infers provenance from low-entropy values in provider protocol fields (%s)',
    async (secret) => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
      ])
      registry.recordResolved('TOKEN', secret)
      const converted = secret === '123' ? 123 : true

      await executeProviderRequest(
        'openai',
        {
          model: 'test-model',
          messages: [
            {
              role: 'assistant',
              name: 'assistant-safe',
              content: secret,
              function_call: {
                name: 'legacy-safe',
                arguments: JSON.stringify({ value: secret, converted }),
              },
              tool_calls: [
                {
                  id: secret,
                  type: 'function',
                  function: {
                    name: 'tool-safe',
                    arguments: JSON.stringify({ value: secret, converted }),
                  },
                },
              ],
              tool_call_id: secret,
              files: [
                {
                  id: secret,
                  name: `${secret}.txt`,
                  url: `https://files.example/${secret}`,
                  size: 4,
                  type: secret,
                  key: secret,
                  context: `Context ${secret}`,
                  providerFileId: secret,
                  providerFileUri: `provider://${secret}`,
                  remoteUrl: `https://remote.example/${secret}`,
                },
              ],
            },
          ],
          tools: [
            {
              id: 'safe_tool',
              name: 'Safe Tool',
              description: `Description ${secret}`,
              params: { runtimeControl: secret },
              parameters: {
                type: 'object',
                properties: {
                  value: {
                    type: 'string',
                    title: `Title ${secret}`,
                    description: `Field ${secret}`,
                    enum: ['public'],
                  },
                },
                required: ['value'],
              },
            },
            {
              id: 'unsafe_schema_tool',
              name: 'Unsafe schema tool',
              description: 'Unsafe schema',
              params: {},
              parameters: {
                type: 'object',
                properties: { [secret]: { type: 'string' } },
                required: [secret],
              },
            },
            {
              id: 'unsafe_name_tool',
              name: secret,
              description: 'Unsafe name',
              params: {},
              parameters: { type: 'object', properties: {}, required: [] },
            },
          ],
          responseFormat: {
            name: secret,
            schema: {
              type: 'object',
              properties: {
                value: {
                  type: 'string',
                  description: `Result ${secret}`,
                  enum: ['public'],
                },
              },
              required: ['value'],
            },
          },
        },
        { resolvedSecretTraceRegistry: registry }
      )

      const sent = mockExecuteRequest.mock.calls.at(-1)?.[0]
      expect(sent.messages[0]).toMatchObject({
        role: 'assistant',
        name: 'assistant-safe',
        content: secret,
        function_call: {
          name: 'legacy-safe',
        },
        tool_calls: [
          {
            id: secret,
            function: {
              name: 'tool-safe',
            },
          },
        ],
        tool_call_id: secret,
      })
      expect(JSON.parse(sent.messages[0].function_call.arguments)).toEqual({
        value: secret,
        converted,
      })
      expect(JSON.parse(sent.messages[0].tool_calls[0].function.arguments)).toEqual({
        value: secret,
        converted,
      })
      expect(sent.messages[0].files[0]).toEqual({
        id: secret,
        name: `${secret}.txt`,
        url: `https://files.example/${secret}`,
        size: 4,
        type: secret,
        key: secret,
        context: `Context ${secret}`,
        providerFileId: secret,
        providerFileUri: `provider://${secret}`,
        remoteUrl: `https://remote.example/${secret}`,
      })
      expect(sent.tools).toHaveLength(3)
      expect(sent.tools[0]).toMatchObject({
        id: 'safe_tool',
        name: 'Safe Tool',
        description: `Description ${secret}`,
        params: { runtimeControl: secret },
        parameters: {
          properties: {
            value: {
              title: `Title ${secret}`,
              description: `Field ${secret}`,
              enum: ['public'],
            },
          },
          required: ['value'],
        },
      })
      expect(sent.responseFormat.name).toBe(secret)
      expect(sent.responseFormat).toMatchObject({
        schema: {
          properties: {
            value: {
              description: `Result ${secret}`,
              enum: ['public'],
            },
          },
          required: ['value'],
        },
      })
    }
  )

  it.each(ARBITRARY_SCHEMA_CONTROL_KEYS)(
    'preserves caller-prepared %s schema controls without plaintext inference',
    async (controlKey) => {
      const secret = `schema-control-secret-${controlKey}`
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
      ])
      registry.recordResolved('TOKEN', secret)
      const unsafeSchema = {
        type: 'object',
        properties: {},
        [controlKey]: secret,
      }

      await executeProviderRequest(
        'openai',
        {
          model: 'test-model',
          tools: [
            {
              id: 'unsafe_tool',
              name: 'Unsafe tool',
              description: 'Unsafe schema control',
              params: {},
              parameters: unsafeSchema,
            },
            {
              id: 'safe_tool',
              name: 'Safe tool',
              description: 'Safe schema',
              params: {},
              parameters: { type: 'object', properties: {} },
            },
          ],
        },
        { resolvedSecretTraceRegistry: registry }
      )

      expect(mockExecuteRequest.mock.calls.at(-1)?.[0].tools).toEqual([
        expect.objectContaining({ id: 'unsafe_tool', parameters: unsafeSchema }),
        expect.objectContaining({ id: 'safe_tool' }),
      ])

      mockExecuteRequest.mockClear()
      await executeProviderRequest(
        'openai',
        {
          model: 'test-model',
          messages: [{ role: 'user', content: 'Continue safely' }],
          responseFormat: { name: 'unsafe_response', schema: unsafeSchema },
        },
        { resolvedSecretTraceRegistry: registry }
      )
      expect(mockExecuteRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Continue safely' }],
          responseFormat: { name: 'unsafe_response', schema: unsafeSchema },
        })
      )
      expect(JSON.stringify(mockExecuteRequest.mock.calls.at(-1)?.[0])).toContain(secret)
    }
  )

  it.each([
    ['string', { type: 'string' }],
    ['true', { type: 'object', nullable: true }],
  ])(
    'preserves validated schema controls when they equal active secret bytes (%s)',
    async (secret, schema) => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
      ])
      registry.recordResolved('TOKEN', secret)

      await executeProviderRequest(
        'openai',
        {
          model: 'test-model',
          tools: [
            {
              id: 'canonical_tool',
              name: 'Canonical tool',
              description: 'Canonical control',
              params: {},
              parameters: schema,
            },
            {
              id: 'safe_tool',
              name: 'Safe tool',
              description: 'Safe schema',
              params: {},
              parameters: { type: 'object', properties: {} },
            },
          ],
        },
        { resolvedSecretTraceRegistry: registry }
      )

      expect(mockExecuteRequest.mock.calls.at(-1)?.[0].tools).toEqual([
        expect.objectContaining({ id: 'canonical_tool', parameters: schema }),
        expect.objectContaining({ id: 'safe_tool' }),
      ])

      mockExecuteRequest.mockClear()
      await executeProviderRequest(
        'openai',
        {
          model: 'test-model',
          responseFormat: { name: 'canonical_response', schema },
        },
        { resolvedSecretTraceRegistry: registry }
      )
      expect(mockExecuteRequest.mock.calls.at(-1)?.[0].responseFormat?.schema).toEqual(schema)
    }
  )

  it('forwards safe canonical schema controls byte-for-byte', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'unrelated-secret', encryptedValue: 'ciphertext' },
    ])
    const schema = {
      type: ['object', 'null'],
      nullable: true,
      readOnly: false,
      properties: { value: { type: 'string' } },
    }

    await executeProviderRequest(
      'openai',
      {
        model: 'test-model',
        responseFormat: { name: 'safe_response', schema },
      },
      { resolvedSecretTraceRegistry: registry }
    )

    expect(mockExecuteRequest.mock.calls.at(-1)?.[0].responseFormat?.schema).toEqual(schema)
  })

  it.each(['123', 'true'])(
    'preserves a response schema whose semantic value equals an active secret (%s)',
    async (secret) => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
      ])
      registry.recordResolved('TOKEN', secret)
      const semanticValue = secret === '123' ? 123 : true

      await executeProviderRequest(
        'openai',
        {
          model: 'test-model',
          messages: [{ role: 'user', content: 'Continue safely' }],
          responseFormat: {
            name: 'safe_response',
            schema: { type: 'object', properties: {}, enum: [semanticValue] },
          },
        },
        { resolvedSecretTraceRegistry: registry }
      )
      expect(mockExecuteRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Continue safely' }],
          responseFormat: {
            name: 'safe_response',
            schema: { type: 'object', properties: {}, enum: [semanticValue] },
          },
        })
      )
      expect(mockExecuteRequest.mock.calls.at(-1)?.[0].systemPrompt).toBeUndefined()
    }
  )

  it('does not make provider execution depend on registry completeness', async () => {
    const incomplete = new ResolvedSecretTraceRegistry()
    incomplete.markIncomplete('unspecified')

    await executeProviderRequest(
      'anthropic',
      { model: 'test-model', messages: [{ role: 'user', content: 'possibly secret' }] },
      { resolvedSecretTraceRegistry: incomplete }
    )
    await executeProviderRequest(
      'anthropic',
      { model: 'test-model', messages: [{ role: 'user', content: 'possibly secret' }] },
      {}
    )
    expect(mockExecuteRequest).toHaveBeenCalledTimes(2)
  })

  it('leaves non-workflow provider callers unchanged when no runtime context is supplied', async () => {
    await executeProviderRequest('anthropic', {
      model: 'test-model',
      messages: [{ role: 'user', content: 'raw standalone content' }],
    })

    expect(mockExecuteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'raw standalone content' }],
      })
    )
  })
})

/**
 * `reasoningEffort`, `verbosity`, and `thinkingLevel` can be bound to a variable or block
 * reference in the agent block, so by the time they reach the provider they hold whatever
 * that reference resolved to rather than a value picked from a list.
 */
describe('executeProviderRequest — model level normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-rotating', isBYOK: false })
    mockExecuteRequest.mockResolvedValue({
      content: 'hi',
      model: 'gpt-5',
      tokens: { input: 1, output: 1, total: 2 },
    } as ProviderResponse)
  })

  const sentRequest = () => mockExecuteRequest.mock.calls[0][0] as Record<string, unknown>

  it('trims and lower-cases levels a reference resolved to', async () => {
    await executeProviderRequest('openai', {
      model: 'gpt-5',
      workspaceId: 'ws-1',
      reasoningEffort: ' High ',
      verbosity: 'LOW',
    })

    expect(sentRequest().reasoningEffort).toBe('high')
    expect(sentRequest().verbosity).toBe('low')
  })

  it('trims and lower-cases a thinking level a reference resolved to', async () => {
    await executeProviderRequest('anthropic', {
      model: 'claude-sonnet-5',
      workspaceId: 'ws-1',
      thinkingLevel: ' High ',
    })

    expect(sentRequest().thinkingLevel).toBe('high')
  })

  it('treats a level that resolved to nothing as unset rather than an empty string', async () => {
    await executeProviderRequest('openai', {
      model: 'gpt-5',
      workspaceId: 'ws-1',
      reasoningEffort: '',
      verbosity: '   ',
    })

    expect(sentRequest().reasoningEffort).toBeUndefined()
    expect(sentRequest().verbosity).toBeUndefined()
  })

  /**
   * Providers treat an explicit `'none'` as "thinking off" and an absent value as "send
   * nothing", so a reference that resolved to nothing must land on the latter.
   */
  it('treats a thinking level that resolved to nothing as unset, not as none', async () => {
    await executeProviderRequest('anthropic', {
      model: 'claude-sonnet-5',
      workspaceId: 'ws-1',
      thinkingLevel: '  ',
    })

    expect(sentRequest().thinkingLevel).toBeUndefined()
  })

  it('preserves an explicit none thinking level', async () => {
    await executeProviderRequest('anthropic', {
      model: 'claude-sonnet-5',
      workspaceId: 'ws-1',
      thinkingLevel: 'none',
    })

    expect(sentRequest().thinkingLevel).toBe('none')
  })

  it('leaves an already-valid level untouched', async () => {
    await executeProviderRequest('openai', {
      model: 'gpt-5',
      workspaceId: 'ws-1',
      reasoningEffort: 'medium',
      verbosity: 'high',
    })

    expect(sentRequest().reasoningEffort).toBe('medium')
    expect(sentRequest().verbosity).toBe('high')
  })

  it('keeps the reasoning effort a Grok model declares', async () => {
    await executeProviderRequest('xai', {
      model: 'grok-4.6',
      workspaceId: 'ws-1',
      reasoningEffort: 'xhigh',
    })

    expect(sentRequest().reasoningEffort).toBe('xhigh')
  })

  it('drops the reasoning effort for a Grok model that rejects the parameter', async () => {
    await executeProviderRequest('xai', {
      model: 'grok-4.20-0309-reasoning',
      workspaceId: 'ws-1',
      reasoningEffort: 'high',
    })

    expect(sentRequest().reasoningEffort).toBeUndefined()
  })

  /**
   * Sim's per-model level lists drive the pickers and can lag a provider that has started
   * accepting a new level, so an unrecognized level is forwarded rather than dropped: the
   * provider answers with an error naming the values it accepts, instead of Sim silently
   * substituting the model default and quietly corrupting a sweep.
   */
  it('forwards a level the model does not declare so the provider reports it', async () => {
    await executeProviderRequest('openai', {
      model: 'gpt-5',
      workspaceId: 'ws-1',
      reasoningEffort: 'xhigh',
    })

    expect(sentRequest().reasoningEffort).toBe('xhigh')
  })

  it('still drops levels the resolved model does not support', async () => {
    await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
      reasoningEffort: 'high',
      verbosity: 'high',
    })

    expect(sentRequest().reasoningEffort).toBeUndefined()
    expect(sentRequest().verbosity).toBeUndefined()
  })

  /**
   * A model the catalogue has never seen is unknown, not known-incapable — which is exactly
   * how a newly released model arrives through a reference before Sim catalogues it. The
   * provider decides, rather than the level being discarded on a stale list.
   */
  it('forwards levels for a model absent from the catalogue', async () => {
    await executeProviderRequest('openai', {
      model: 'gpt-6-unreleased',
      workspaceId: 'ws-1',
      reasoningEffort: 'high',
    })

    expect(sentRequest().reasoningEffort).toBe('high')
  })

  it('still drops levels for a dynamic-provider model that does not take them', async () => {
    await executeProviderRequest('ollama', {
      model: 'ollama/llama3',
      workspaceId: 'ws-1',
      reasoningEffort: 'high',
    })

    expect(sentRequest().reasoningEffort).toBeUndefined()
  })
})
