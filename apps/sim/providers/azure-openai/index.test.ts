/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { ProviderRequest, ProviderToolConfig } from '@/providers/types'

const {
  mockAzureOpenAI,
  azureOpenAIArgs,
  mockChatCreate,
  mockValidate,
  mockCreatePinnedFetch,
  mockExecuteResponses,
  sentinelFetch,
  mockIsChatCompletionsEndpoint,
  mockIsResponsesEndpoint,
  mockPrepareTools,
  mockExecuteTool,
} = vi.hoisted(() => {
  const azureOpenAIArgs: Array<Record<string, unknown>> = []
  const sentinelFetch = vi.fn()
  const mockChatCreate = vi.fn()
  class MockAzureOpenAI {
    chat = { completions: { create: mockChatCreate } }
    constructor(opts: Record<string, unknown>) {
      azureOpenAIArgs.push(opts)
    }
  }
  return {
    mockAzureOpenAI: MockAzureOpenAI,
    azureOpenAIArgs,
    mockChatCreate,
    mockValidate: vi.fn(),
    mockCreatePinnedFetch: vi.fn(() => sentinelFetch),
    mockExecuteResponses: vi.fn(),
    sentinelFetch,
    mockIsChatCompletionsEndpoint: vi.fn(() => false),
    mockIsResponsesEndpoint: vi.fn(() => false),
    mockPrepareTools: vi.fn(),
    mockExecuteTool: vi.fn(),
  }
})

vi.mock('openai', () => ({ AzureOpenAI: mockAzureOpenAI }))
vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 20 }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateUrlWithDNS: mockValidate,
  createPinnedFetch: mockCreatePinnedFetch,
}))
vi.mock('@/providers/openai/core', () => ({
  executeResponsesProviderRequest: mockExecuteResponses,
}))
vi.mock('@/providers/azure-openai/utils', () => ({
  isChatCompletionsEndpoint: mockIsChatCompletionsEndpoint,
  isResponsesEndpoint: mockIsResponsesEndpoint,
  extractBaseUrl: vi.fn((url: string) => url),
  extractDeploymentFromUrl: vi.fn(() => null),
  extractApiVersionFromUrl: vi.fn(() => null),
  createReadableStreamFromAzureOpenAIStream: vi.fn(),
  checkForForcedToolUsage: vi.fn(() => ({ hasUsedForcedTool: false, usedForcedTools: [] })),
}))
vi.mock('@/providers/models', () => ({
  getProviderFileAttachment: vi
    .fn()
    .mockReturnValue({ maxBytes: 10 * 1024 * 1024, strategy: 'inline' }),
  INLINE_ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024,
  getProviderModels: vi.fn(() => []),
  getProviderDefaultModel: vi.fn(() => 'azure/gpt-4o'),
}))
vi.mock('@/providers/attachments', () => ({
  prepareProviderAttachments: vi.fn(() => []),
}))
vi.mock('@/providers/trace-enrichment', () => ({
  enrichLastModelSegmentFromChatCompletions: vi.fn(),
}))
vi.mock('@/providers/utils', () => ({
  calculateCost: vi.fn(() => ({ input: 0, output: 0, total: 0 })),
  prepareToolExecution: vi.fn((_tool, args) => ({ toolParams: args, executionParams: args })),
  prepareToolsWithUsageControl: mockPrepareTools,
  sumToolCosts: vi.fn(() => 0),
}))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

import { azureOpenAIProvider } from '@/providers/azure-openai/index'

function request(overrides: Partial<ProviderRequest>): ProviderRequest {
  return { model: 'azure/gpt-4o', apiKey: 'k', messages: [], ...overrides }
}

function makeTool(id: string): ProviderToolConfig {
  return {
    id,
    name: id,
    description: '',
    params: {},
    parameters: { type: 'object', properties: {}, required: [] },
  }
}

async function readAgentEvents(stream: ReadableStream<AgentStreamEvent>) {
  const events: AgentStreamEvent[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return events
    events.push(value)
  }
}

/** Config object passed to the Responses core on the Nth call. */
const responsesConfig = (call = 0) => mockExecuteResponses.mock.calls[call][1]

afterAll(resetEnvMock)

describe('azureOpenAIProvider — SSRF pinning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    azureOpenAIArgs.length = 0
    setEnv({ AZURE_OPENAI_ENDPOINT: undefined, AZURE_OPENAI_API_VERSION: undefined })
    mockIsChatCompletionsEndpoint.mockReturnValue(false)
    mockIsResponsesEndpoint.mockReturnValue(false)
    mockExecuteResponses.mockResolvedValue({ content: 'ok' })
    mockPrepareTools.mockReturnValue({
      tools: [],
      toolChoice: undefined,
      forcedTools: [],
    })
    mockExecuteTool.mockResolvedValue({ success: true, output: { ok: true } })
  })

  describe('Responses API path', () => {
    it('validates and threads the pinned fetch into the Responses core for a user endpoint', async () => {
      mockValidate.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })

      await azureOpenAIProvider.executeRequest(
        request({ azureEndpoint: 'https://rebind.attacker.tld' })
      )

      expect(mockValidate).toHaveBeenCalledWith('https://rebind.attacker.tld', 'azureEndpoint')
      expect(mockCreatePinnedFetch).toHaveBeenCalledWith('203.0.113.10')
      expect(responsesConfig().fetch).toBe(sentinelFetch)
    })

    it('passes no custom fetch when the endpoint comes from trusted server env', async () => {
      setEnv({ AZURE_OPENAI_ENDPOINT: 'https://trusted.openai.azure.com' })

      await azureOpenAIProvider.executeRequest(request({ azureEndpoint: undefined }))

      expect(mockValidate).not.toHaveBeenCalled()
      expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
      expect(responsesConfig().fetch).toBeUndefined()
    })

    it('throws and never reaches the Responses core when validation blocks the endpoint', async () => {
      mockValidate.mockResolvedValue({ isValid: false, error: 'resolves to a blocked IP address' })

      await expect(
        azureOpenAIProvider.executeRequest(
          request({ azureEndpoint: 'https://rebind.attacker.tld' })
        )
      ).rejects.toThrow('Invalid Azure OpenAI endpoint')

      expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
      expect(mockExecuteResponses).not.toHaveBeenCalled()
    })

    it('fails closed when validation passes but yields no resolvable IP to pin', async () => {
      mockValidate.mockResolvedValue({ isValid: true })

      await expect(
        azureOpenAIProvider.executeRequest(
          request({ azureEndpoint: 'https://rebind.attacker.tld' })
        )
      ).rejects.toThrow('could not resolve a pinnable IP address')

      expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
      expect(mockExecuteResponses).not.toHaveBeenCalled()
    })
  })

  describe('Chat Completions path', () => {
    it('constructs the AzureOpenAI client with the pinned fetch for a user endpoint', async () => {
      mockIsChatCompletionsEndpoint.mockReturnValue(true)
      mockValidate.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'hi', tool_calls: undefined } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })

      await azureOpenAIProvider.executeRequest(
        request({
          azureEndpoint: 'https://rebind.attacker.tld/openai/deployments/gpt-4o/chat/completions',
        })
      )

      expect(mockCreatePinnedFetch).toHaveBeenCalledWith('203.0.113.10')
      expect(azureOpenAIArgs[0]).toMatchObject({ fetch: sentinelFetch })
    })

    it('constructs the AzureOpenAI client without a custom fetch for a trusted env endpoint', async () => {
      mockIsChatCompletionsEndpoint.mockReturnValue(true)
      setEnv({
        AZURE_OPENAI_ENDPOINT:
          'https://trusted.openai.azure.com/openai/deployments/gpt-4o/chat/completions',
      })
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'hi', tool_calls: undefined } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })

      await azureOpenAIProvider.executeRequest(request({ azureEndpoint: undefined }))

      expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
      expect(azureOpenAIArgs[0]).not.toHaveProperty('fetch')
    })

    it('projects the settled tool-loop answer without a final streaming request', async () => {
      mockIsChatCompletionsEndpoint.mockReturnValue(true)
      mockValidate.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
      mockPrepareTools.mockReturnValue({
        tools: [{ type: 'function', function: { name: 'lookup' } }],
        toolChoice: 'auto',
        forcedTools: [],
      })
      mockChatCreate
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'lookup', arguments: '{}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'done', tool_calls: undefined } }],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        })

      const result = await azureOpenAIProvider.executeRequest(
        request({
          azureEndpoint: 'https://rebind.attacker.tld/openai/deployments/gpt-4o/chat/completions',
          stream: true,
          tools: [makeTool('lookup')],
        })
      )

      expect(mockChatCreate).toHaveBeenCalledTimes(2)
      expect(mockExecuteTool).toHaveBeenCalledTimes(1)
      expect('stream' in result).toBe(true)
      if (!('stream' in result)) throw new Error('Expected streaming execution')
      expect(result.execution.output.content).toBe('done')
      expect(result.execution.output.tokens).toEqual({ input: 6, output: 3, total: 9 })
      expect(result.execution.output.providerTiming?.iterations).toBe(2)
      expect(
        result.execution.output.providerTiming?.timeSegments?.filter(
          (segment) => segment.type === 'model'
        )
      ).toHaveLength(2)
      await expect(
        readAgentEvents(result.stream as ReadableStream<AgentStreamEvent>)
      ).resolves.toEqual([{ type: 'text_delta', text: 'done', turn: 'final' }])
    })
  })
})
