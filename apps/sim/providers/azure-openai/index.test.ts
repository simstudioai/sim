import { resetEnvMock, setEnv } from '@sim/testing'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { openaiMock, openaiMockFns } from '@sim/testing/mocks/openai.mock'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersAttachmentsMock } from '@sim/testing/mocks/providers-attachments.mock'
import { providersModelsMock } from '@sim/testing/mocks/providers-models.mock'
import { providersTraceEnrichmentMock } from '@sim/testing/mocks/providers-trace-enrichment.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { ProviderRequest, ProviderToolConfig } from '@/providers/types'

const {
  mockExecuteResponses,
  sentinelFetch,
  mockIsChatCompletionsEndpoint,
  mockIsResponsesEndpoint,
} = vi.hoisted(() => ({
  mockExecuteResponses: vi.fn(),
  sentinelFetch: vi.fn(),
  mockIsChatCompletionsEndpoint: vi.fn(() => false),
  mockIsResponsesEndpoint: vi.fn(() => false),
}))

vi.mock('openai', () => openaiMock)
vi.mock('@/providers', () => providersMock)
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
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
vi.mock('@/providers/models', () => providersModelsMock)
vi.mock('@/providers/attachments', () => providersAttachmentsMock)
vi.mock('@/providers/trace-enrichment', () => providersTraceEnrichmentMock)
vi.mock('@/providers/utils', () => providersUtilsMock)
vi.mock('@/tools', () => toolsMock)

import { azureOpenAIProvider } from '@/providers/azure-openai/index'

const mockChatCreate = openaiMockFns.mockChatCompletionsCreate
/** Options each `new AzureOpenAI(...)` received, in construction order. */
const azureOpenAIArgs = () =>
  openaiMockFns.mockAzureOpenAI.mock.calls.map(
    (call) => (call as unknown[])[0] as Record<string, unknown>
  )

const mockCreatePinnedFetch = inputValidationMockFns.mockCreatePinnedFetch
mockCreatePinnedFetch.mockImplementation(() => sentinelFetch)
const mockValidate = inputValidationMockFns.mockValidateUrlWithDNS
const mockPrepareTools = providersUtilsMockFns.mockPrepareToolsWithUsageControl
const mockExecuteTool = toolsMockFns.mockExecuteTool

function request(overrides: Partial<ProviderRequest>): ProviderRequest {
  return { model: 'azure/gpt-4o', apiKey: 'k', messages: [], ...overrides }
}

function makeTool(id: string): ProviderToolConfig {
  return {
    id,
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

      expect(mockValidate).toHaveBeenCalledWith(
        'https://rebind.attacker.tld',
        'azureEndpoint',
        'configuredEndpoint'
      )
      expect(mockCreatePinnedFetch).toHaveBeenCalledWith('203.0.113.10', {
        profile: 'configuredEndpoint',
      })
      expect(responsesConfig().fetch).toBe(sentinelFetch)
    })

    it('passes no custom fetch when the endpoint comes from trusted server env', async () => {
      setEnv({ AZURE_OPENAI_ENDPOINT: 'https://trusted.openai.azure.com' })

      await azureOpenAIProvider.executeRequest(request({ azureEndpoint: undefined }))

      expect(mockValidate).not.toHaveBeenCalled()
      expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
      expect(responsesConfig().fetch).toBeUndefined()
    })

    it.each([false, true])(
      'preserves a custom deployment name through Responses routing (full endpoint: %s)',
      async (fullEndpoint) => {
        mockIsResponsesEndpoint.mockReturnValue(fullEndpoint)
        setEnv({ AZURE_OPENAI_ENDPOINT: 'https://custom.openai.azure.com' })
        const providerRequest = request({ model: 'AZURE/Team-GPT-Deployment' })

        await azureOpenAIProvider.executeRequest(providerRequest)

        expect(mockExecuteResponses.mock.calls[0][0].model).toBe('AZURE/Team-GPT-Deployment')
        expect(responsesConfig().modelName).toBe('Team-GPT-Deployment')
      }
    )

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

      expect(mockCreatePinnedFetch).toHaveBeenCalledWith('203.0.113.10', {
        profile: 'configuredEndpoint',
      })
      expect(azureOpenAIArgs()[0]).toMatchObject({ fetch: sentinelFetch })
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
      expect(azureOpenAIArgs()[0]).not.toHaveProperty('fetch')
    })

    it('preserves a custom deployment name through Chat Completions routing', async () => {
      mockIsChatCompletionsEndpoint.mockReturnValue(true)
      setEnv({
        AZURE_OPENAI_ENDPOINT: 'https://custom.openai.azure.com/openai/v1/chat/completions',
      })
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'hi' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })

      await azureOpenAIProvider.executeRequest(request({ model: 'AZURE/Team-GPT-Deployment' }))

      expect(mockChatCreate.mock.calls[0][0].model).toBe('Team-GPT-Deployment')
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
