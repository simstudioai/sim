/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRequest } from '@/providers/types'

const {
  mockAnthropic,
  anthropicArgs,
  mockValidate,
  mockCreatePinnedFetch,
  mockExecuteAnthropic,
  sentinelFetch,
  envState,
} = vi.hoisted(() => {
  const anthropicArgs: Array<Record<string, unknown>> = []
  const sentinelFetch = vi.fn()
  class MockAnthropic {
    constructor(opts: Record<string, unknown>) {
      anthropicArgs.push(opts)
    }
  }
  return {
    mockAnthropic: MockAnthropic,
    anthropicArgs,
    mockValidate: vi.fn(),
    mockCreatePinnedFetch: vi.fn(() => sentinelFetch),
    mockExecuteAnthropic: vi.fn(),
    sentinelFetch,
    envState: {
      AZURE_ANTHROPIC_ENDPOINT: undefined as string | undefined,
      AZURE_ANTHROPIC_API_VERSION: undefined as string | undefined,
    },
  }
})

vi.mock('@anthropic-ai/sdk', () => ({ default: mockAnthropic }))
vi.mock('@/lib/core/config/env', () => ({
  env: envState,
  getEnv: (key: string) => (envState as Record<string, string | undefined>)[key],
  isTruthy: (v: unknown) => v === true || v === 'true' || v === '1',
  isFalsy: (v: unknown) => v === false || v === 'false' || v === '0',
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateUrlWithDNS: mockValidate,
  createPinnedFetch: mockCreatePinnedFetch,
}))
vi.mock('@/providers/anthropic/core', () => ({
  executeAnthropicProviderRequest: mockExecuteAnthropic,
}))
vi.mock('@/providers/models', () => ({
  getProviderFileAttachment: vi
    .fn()
    .mockReturnValue({ maxBytes: 10 * 1024 * 1024, strategy: 'inline' }),
  INLINE_ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024,
  getProviderModels: vi.fn(() => []),
  getProviderDefaultModel: vi.fn(() => 'azure-anthropic/claude'),
}))

import { azureAnthropicProvider } from '@/providers/azure-anthropic/index'

function request(overrides: Partial<ProviderRequest>): ProviderRequest {
  return { model: 'azure-anthropic/claude-3-5-sonnet', apiKey: 'k', messages: [], ...overrides }
}

/** Invokes the createClient factory handed to the Anthropic core and returns the SDK options it built. */
function buildClientOptions(): Record<string, unknown> {
  const config = mockExecuteAnthropic.mock.calls[0][1]
  config.createClient('k', false)
  return anthropicArgs[0]
}

describe('azureAnthropicProvider — SSRF pinning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    anthropicArgs.length = 0
    envState.AZURE_ANTHROPIC_ENDPOINT = undefined
    envState.AZURE_ANTHROPIC_API_VERSION = undefined
    mockExecuteAnthropic.mockResolvedValue({ content: 'ok' })
  })

  it('validates and pins the connection to the resolved IP for a user-supplied endpoint', async () => {
    mockValidate.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })

    await azureAnthropicProvider.executeRequest(
      request({ azureEndpoint: 'https://rebind.attacker.tld' })
    )

    expect(mockValidate).toHaveBeenCalledWith('https://rebind.attacker.tld', 'azureEndpoint')
    expect(mockCreatePinnedFetch).toHaveBeenCalledWith('203.0.113.10')
    expect(buildClientOptions()).toMatchObject({ fetch: sentinelFetch })
  })

  it('does not pin when the endpoint comes from trusted server env', async () => {
    envState.AZURE_ANTHROPIC_ENDPOINT = 'https://trusted.services.ai.azure.com'

    await azureAnthropicProvider.executeRequest(request({ azureEndpoint: undefined }))

    expect(mockValidate).not.toHaveBeenCalled()
    expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
    expect(buildClientOptions()).not.toHaveProperty('fetch')
  })

  it('throws and never builds a client when validation blocks the endpoint', async () => {
    mockValidate.mockResolvedValue({ isValid: false, error: 'resolves to a blocked IP address' })

    await expect(
      azureAnthropicProvider.executeRequest(
        request({ azureEndpoint: 'https://rebind.attacker.tld' })
      )
    ).rejects.toThrow('Invalid Azure Anthropic endpoint')

    expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
    expect(mockExecuteAnthropic).not.toHaveBeenCalled()
  })

  it('fails closed when validation passes but yields no resolvable IP to pin', async () => {
    mockValidate.mockResolvedValue({ isValid: true })

    await expect(
      azureAnthropicProvider.executeRequest(
        request({ azureEndpoint: 'https://rebind.attacker.tld' })
      )
    ).rejects.toThrow('could not resolve a pinnable IP address')

    expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
    expect(mockExecuteAnthropic).not.toHaveBeenCalled()
  })
})
