import { vi } from 'vitest'

type MockUploadSessionErrorCode =
  | 'validation'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'payload_too_large'
  | 'internal'

/**
 * Mirrors `UploadSessionError` from `@/lib/uploads/upload-session/service`: same `name`, `code`
 * and `(code, message)` constructor. It extends `Error`, NOT the real `OrchestrationError`, so
 * code that classifies via `instanceof OrchestrationError` will not match it; code reading
 * `.code` (or `instanceof` against the mocked export) does.
 */
export class MockUploadSessionError extends Error {
  constructor(
    readonly code: MockUploadSessionErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'UploadSessionError'
  }
}

interface MockMultipartSession {
  method: string
  partSize?: number | null
  partCount?: number | null
  fileSize: number
}

interface MockSessionMetadataSource {
  id: string
  userId: string
  workspaceId?: string | null
  purpose: string
  fileName: string
  knowledgeBaseId?: string | null
  workflowId?: string | null
  executionId?: string | null
}

/**
 * Controllable mock functions for `@/lib/uploads/upload-session/service`.
 *
 * Every session/binding function is a bare `vi.fn()` (so `assertUploadSessionAuthBinding` is a
 * no-op that admits every principal). Two pure helpers are faithful ports:
 * - `mockExpectedUploadPartSize(session, partNumber)` → the real part-size arithmetic, throwing
 *   {@link MockUploadSessionError} (`conflict` / `validation`) like production.
 * - `mockUploadSessionObjectMetadata(session)` → the real object-metadata record.
 *
 * @example
 * ```ts
 * import { uploadSessionMockFns } from '@sim/testing/mocks/upload-session.mock'
 *
 * uploadSessionMockFns.mockGetOwnedUploadSession.mockResolvedValue(session)
 * ```
 */
export const uploadSessionMockFns = {
  mockCreateUploadSession: vi.fn(),
  mockGetOwnedUploadSession: vi.fn(),
  mockGetPrincipalUploadSession: vi.fn(),
  mockGetPrincipalKnowledgeDocumentUploadSession: vi.fn(),
  mockCreateUploadSessionAuthBinding: vi.fn(),
  mockAssertUploadSessionAuthBinding: vi.fn(),
  mockVerifyUploadSessionToken: vi.fn(),
  mockCreateUploadPartUrls: vi.fn(),
  mockCompleteUploadSession: vi.fn(),
  mockAbortUploadSession: vi.fn(),
  mockCleanupExpiredUploadSessions: vi.fn(),
  mockExpectedUploadPartSize: vi.fn((session: MockMultipartSession, partNumber: number): number => {
    if (session.method !== 'multipart' || !session.partSize || !session.partCount) {
      throw new MockUploadSessionError(
        'conflict',
        'PUT upload sessions do not have multipart parts'
      )
    }
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > session.partCount) {
      throw new MockUploadSessionError(
        'validation',
        `partNumber must be between 1 and ${session.partCount}`
      )
    }
    if (partNumber < session.partCount) return session.partSize
    return session.fileSize - session.partSize * (session.partCount - 1)
  }),
  mockUploadSessionObjectMetadata: vi.fn(
    (session: MockSessionMetadataSource): Record<string, string> => ({
      uploadId: session.id,
      userId: session.userId,
      originalName: session.fileName,
      purpose: session.purpose,
      ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
      ...(session.knowledgeBaseId ? { knowledgeBaseId: session.knowledgeBaseId } : {}),
      ...(session.workflowId ? { workflowId: session.workflowId } : {}),
      ...(session.executionId ? { executionId: session.executionId } : {}),
    })
  ),
}

/**
 * Static mock module for `@/lib/uploads/upload-session/service`. Constants carry the real values;
 * `UploadSessionError` is {@link MockUploadSessionError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/uploads/upload-session/service', () => uploadSessionMock)
 * ```
 */
export const uploadSessionMock = {
  UPLOAD_SESSION_PUT_MAX_BYTES: 50 * 1024 * 1024,
  UPLOAD_SESSION_PART_SIZE: 8 * 1024 * 1024,
  UPLOAD_SESSION_LOCAL_PUT_MAX_BYTES: 8 * 1024 * 1024,
  UPLOAD_SESSION_MAX_PART_URLS: 100,
  UPLOAD_SESSION_TTL_MS: 24 * 60 * 60 * 1000,
  UPLOAD_SESSION_ASSET_MAX_BYTES: 5 * 1024 * 1024,
  UploadSessionError: MockUploadSessionError,
  createUploadSession: uploadSessionMockFns.mockCreateUploadSession,
  getOwnedUploadSession: uploadSessionMockFns.mockGetOwnedUploadSession,
  getPrincipalUploadSession: uploadSessionMockFns.mockGetPrincipalUploadSession,
  getPrincipalKnowledgeDocumentUploadSession:
    uploadSessionMockFns.mockGetPrincipalKnowledgeDocumentUploadSession,
  createUploadSessionAuthBinding: uploadSessionMockFns.mockCreateUploadSessionAuthBinding,
  assertUploadSessionAuthBinding: uploadSessionMockFns.mockAssertUploadSessionAuthBinding,
  verifyUploadSessionToken: uploadSessionMockFns.mockVerifyUploadSessionToken,
  createUploadPartUrls: uploadSessionMockFns.mockCreateUploadPartUrls,
  completeUploadSession: uploadSessionMockFns.mockCompleteUploadSession,
  abortUploadSession: uploadSessionMockFns.mockAbortUploadSession,
  cleanupExpiredUploadSessions: uploadSessionMockFns.mockCleanupExpiredUploadSessions,
  expectedUploadPartSize: uploadSessionMockFns.mockExpectedUploadPartSize,
  uploadSessionObjectMetadata: uploadSessionMockFns.mockUploadSessionObjectMetadata,
}
