import { vi } from 'vitest'

type MockBedrockCredentialFailure = 'unauthorized' | 'unusable' | 'unavailable'

/**
 * Stand-in for `BedrockCredentialError` from `@/lib/internal/llm/bedrock-credential`: same `name`,
 * constructor `(message, { reason, cause })`, and `reason` defaulting to `unusable`.
 */
export class MockBedrockCredentialError extends Error {
  readonly reason: MockBedrockCredentialFailure

  constructor(
    message: string,
    options?: { reason?: MockBedrockCredentialFailure; cause?: unknown }
  ) {
    super(message, { cause: options?.cause })
    this.name = 'BedrockCredentialError'
    this.reason = options?.reason ?? 'unusable'
  }
}

/**
 * Controllable mock functions for `@/lib/internal/llm/bedrock-credential`.
 * `mockResolveBedrockCredentialSession` is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { llmBedrockCredentialMockFns } from '@sim/testing/mocks/llm-bedrock-credential.mock'
 *
 * llmBedrockCredentialMockFns.mockResolveBedrockCredentialSession.mockResolvedValueOnce({
 *   credentialId: 'aws-cred', accessKeyId: 'ASIA...', secretAccessKey: 'secret',
 * })
 * ```
 */
export const llmBedrockCredentialMockFns = {
  mockResolveBedrockCredentialSession: vi.fn(),
}

/**
 * Static mock module for `@/lib/internal/llm/bedrock-credential`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/internal/llm/bedrock-credential', () => llmBedrockCredentialMock)
 * ```
 */
export const llmBedrockCredentialMock = {
  BedrockCredentialError: MockBedrockCredentialError,
  resolveBedrockCredentialSession: llmBedrockCredentialMockFns.mockResolveBedrockCredentialSession,
}
