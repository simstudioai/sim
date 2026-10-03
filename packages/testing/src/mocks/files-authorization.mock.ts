import { vi } from 'vitest'

/**
 * Real `FileAccessDeniedError` stand-in so `instanceof` checks against the mocked export
 * and `.name`/`.message` behave as in production.
 */
export class MockFileAccessDeniedError extends Error {
  constructor() {
    super('File not found')
    this.name = 'FileAccessDeniedError'
  }
}

/**
 * Controllable mock functions for `@/app/api/files/authorization`.
 *
 * Defaults grant access: `verifyFileAccess` and `verifyKBFileWriteAccess` resolve `true`,
 * `assertToolFileAccess` resolves `null` (the "allowed, continue" result). Tests of a
 * denial path set it explicitly, e.g.
 * `mockAssertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))`.
 *
 * @example
 * ```ts
 * import { filesAuthorizationMockFns } from '@sim/testing/mocks/files-authorization.mock'
 *
 * filesAuthorizationMockFns.mockVerifyFileAccess.mockResolvedValueOnce(false)
 * ```
 */
export const filesAuthorizationMockFns = {
  mockVerifyFileAccess: vi.fn(async (..._args: unknown[]): Promise<boolean> => true),
  mockVerifyKBFileWriteAccess: vi.fn(async (..._args: unknown[]): Promise<boolean> => true),
  mockAssertToolFileAccess: vi.fn(async (..._args: unknown[]): Promise<Response | null> => null),
}

/**
 * Static mock module for `@/app/api/files/authorization`.
 *
 * @example
 * ```ts
 * vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)
 * ```
 */
export const filesAuthorizationMock = {
  FileAccessDeniedError: MockFileAccessDeniedError,
  verifyFileAccess: filesAuthorizationMockFns.mockVerifyFileAccess,
  verifyKBFileWriteAccess: filesAuthorizationMockFns.mockVerifyKBFileWriteAccess,
  assertToolFileAccess: filesAuthorizationMockFns.mockAssertToolFileAccess,
}
