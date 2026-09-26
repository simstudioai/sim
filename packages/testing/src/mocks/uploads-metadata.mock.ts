import { vi } from 'vitest'

/**
 * Real `ActiveFileMetadataKeyConflictError` stand-in: same `code` and message, so
 * `instanceof` against the mocked export and `.code` checks behave as in production.
 */
export class MockActiveFileMetadataKeyConflictError extends Error {
  readonly code = 'ACTIVE_FILE_KEY_EXISTS' as const

  constructor(key: string) {
    super(`Storage key ${key} is already registered to an active file`)
  }
}

/**
 * Controllable mock functions for `@/lib/uploads/server/metadata`.
 *
 * Lookups default to "nothing stored": `getFileMetadataByKey`/`getFileMetadataById`
 * resolve `null`, `getFileMetadataByKeys` resolves `[]`. `resolveStoredFileContext`
 * defaults to `'workspace'`. Writes are bare `vi.fn()`s.
 *
 * @example
 * ```ts
 * import { uploadsMetadataMockFns } from '@sim/testing/mocks/uploads-metadata.mock'
 *
 * uploadsMetadataMockFns.mockGetFileMetadataByKey.mockResolvedValue({ id: 'file-1', key })
 * ```
 */
export const uploadsMetadataMockFns = {
  mockInsertFileMetadata: vi.fn(),
  mockInsertImmutableFileMetadata: vi.fn(),
  mockInsertFileMetadataMany: vi.fn(),
  mockGetFileMetadataByKey: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
  mockResolveStoredFileContext: vi.fn(async (_key: string): Promise<string> => 'workspace'),
  mockGetFileMetadataByKeys: vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  mockGetFileMetadataById: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
  mockDeleteFileMetadata: vi.fn(),
  mockDeleteFileMetadataByIdentity: vi.fn(),
  mockRecordKnowledgeBaseFileOwnership: vi.fn(),
}

/**
 * Static mock module for `@/lib/uploads/server/metadata`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)
 * ```
 */
export const uploadsMetadataMock = {
  ActiveFileMetadataKeyConflictError: MockActiveFileMetadataKeyConflictError,
  insertFileMetadata: uploadsMetadataMockFns.mockInsertFileMetadata,
  insertImmutableFileMetadata: uploadsMetadataMockFns.mockInsertImmutableFileMetadata,
  insertFileMetadataMany: uploadsMetadataMockFns.mockInsertFileMetadataMany,
  getFileMetadataByKey: uploadsMetadataMockFns.mockGetFileMetadataByKey,
  resolveStoredFileContext: uploadsMetadataMockFns.mockResolveStoredFileContext,
  getFileMetadataByKeys: uploadsMetadataMockFns.mockGetFileMetadataByKeys,
  getFileMetadataById: uploadsMetadataMockFns.mockGetFileMetadataById,
  deleteFileMetadata: uploadsMetadataMockFns.mockDeleteFileMetadata,
  deleteFileMetadataByIdentity: uploadsMetadataMockFns.mockDeleteFileMetadataByIdentity,
  recordKnowledgeBaseFileOwnership: uploadsMetadataMockFns.mockRecordKnowledgeBaseFileOwnership,
}
