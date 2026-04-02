/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSend = vi.fn()

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => {
    return { send: mockSend }
  }),
  ConverseCommand: vi.fn(),
  ConverseStreamCommand: vi.fn(),
}))

vi.mock('@/providers/bedrock/utils', () => ({
  getBedrockInferenceProfileId: vi
    .fn()
    .mockReturnValue('us.anthropic.claude-3-5-sonnet-20241022-v2:0'),
  checkForForcedToolUsage: vi.fn(),
  createReadableStreamFromBedrockStream: vi.fn(),
  generateToolUseId: vi.fn().mockReturnValue('tool-1'),
}))

vi.mock('@/providers/models', () => ({
  getProviderModels: vi.fn().mockReturnValue([]),
  getProviderDefaultModel: vi.fn().mockReturnValue('us.anthropic.claude-3-5-sonnet-20241022-v2:0'),
}))

vi.mock('@/providers/utils', () => ({
  calculateCost: vi.fn().mockReturnValue({ input: 0, output: 0, total: 0, pricing: null }),
  prepareToolExecution: vi.fn(),
  prepareToolsWithUsageControl: vi.fn().mockReturnValue({
    tools: [],
    toolChoice: 'auto',
    forcedTools: [],
  }),
  sumToolCosts: vi.fn().mockReturnValue(0),
}))

vi.mock('@/tools', () => ({
  executeTool: vi.fn(),
}))

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { bedrockProvider } from '@/providers/bedrock/index'

describe('bedrockProvider credential handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({
      output: { message: { content: [{ text: 'response' }] } },
      usage: { inputTokens: 10, outputTokens: 5 },
    })
  })

  const baseRequest = {
    model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
    systemPrompt: 'You are helpful.',
    messages: [{ role: 'user' as const, content: 'Hello' }],
  }

  it('throws when only bedrockAccessKeyId is provided', async () => {
    await expect(
      bedrockProvider.executeRequest({
        ...baseRequest,
        bedrockAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      })
    ).rejects.toThrow('Both bedrockAccessKeyId and bedrockSecretKey must be provided together')
  })

  it('throws when only bedrockSecretKey is provided', async () => {
    await expect(
      bedrockProvider.executeRequest({
        ...baseRequest,
        bedrockSecretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      })
    ).rejects.toThrow('Both bedrockAccessKeyId and bedrockSecretKey must be provided together')
  })

  it('creates client with explicit credentials when both are provided', async () => {
    await bedrockProvider.executeRequest({
      ...baseRequest,
      bedrockAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      bedrockSecretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    })

    expect(BedrockRuntimeClient).toHaveBeenCalledWith({
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
    })
  })

  it('creates client without credentials when neither is provided', async () => {
    await bedrockProvider.executeRequest(baseRequest)

    expect(BedrockRuntimeClient).toHaveBeenCalledWith({
      region: 'us-east-1',
    })
  })

  it('uses custom region when provided', async () => {
    await bedrockProvider.executeRequest({
      ...baseRequest,
      bedrockRegion: 'eu-west-1',
    })

    expect(BedrockRuntimeClient).toHaveBeenCalledWith({
      region: 'eu-west-1',
    })
  })
})
