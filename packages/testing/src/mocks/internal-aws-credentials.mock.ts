import { vi } from 'vitest'

interface MockAwsSession {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  durationSeconds?: number
  expiration?: Date
}

/**
 * Controllable mock functions for `@/lib/internal/aws/credentials`.
 *
 * Defaults: `mockResolveAuthorizedAwsCredential` rejects (no saved credential
 * is configured), the client helpers return the inline keys unchanged, and the
 * wrappers run their operation as-is.
 *
 * @example
 * ```ts
 * import { internalAwsCredentialsMockFns } from '@sim/testing/mocks/internal-aws-credentials.mock'
 *
 * internalAwsCredentialsMockFns.mockResolveAuthorizedAwsCredential.mockResolvedValueOnce({
 *   accessKeyId: 'ASIA...',
 *   secretAccessKey: 'secret',
 *   sessionToken: 'token',
 * })
 * ```
 */
export const internalAwsCredentialsMockFns = {
  mockResolveAuthorizedAwsCredential: vi.fn(
    async (
      _credentialId: string,
      _context: { workspaceId?: string; organizationId?: string; executionId?: string },
      _signal?: AbortSignal
    ): Promise<MockAwsSession> => {
      throw new Error('AWS credential is unavailable')
    }
  ),
  mockAwsClientCredentials: vi.fn((accessKeyId: string, secretAccessKey: string) => ({
    accessKeyId,
    secretAccessKey,
  })),
  mockAwsSessionLifetime: vi.fn((_accessKeyId: string) => undefined),
  mockAwsClientConfig: vi.fn((region: string, accessKeyId: string, secretAccessKey: string) => ({
    region,
    credentials: { accessKeyId, secretAccessKey },
  })),
  mockRunWithAwsSession: vi.fn(
    <Result>(_session: MockAwsSession, operation: () => Promise<Result>) => operation()
  ),
  mockWithAwsCredential: vi.fn(<Handler>(handler: Handler) => handler),
}

/**
 * Static mock module for `@/lib/internal/aws/credentials`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/internal/aws/credentials', () => internalAwsCredentialsMock)
 * ```
 */
export const internalAwsCredentialsMock = {
  resolveAuthorizedAwsCredential: internalAwsCredentialsMockFns.mockResolveAuthorizedAwsCredential,
  awsClientCredentials: internalAwsCredentialsMockFns.mockAwsClientCredentials,
  awsSessionLifetime: internalAwsCredentialsMockFns.mockAwsSessionLifetime,
  awsClientConfig: internalAwsCredentialsMockFns.mockAwsClientConfig,
  runWithAwsSession: internalAwsCredentialsMockFns.mockRunWithAwsSession,
  withAwsCredential: internalAwsCredentialsMockFns.mockWithAwsCredential,
}
