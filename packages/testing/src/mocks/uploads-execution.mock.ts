import { vi } from 'vitest'

interface MockExecutionContext {
  workspaceId: string
  workflowId: string
  executionId: string
}

/** `PATTERNS.UUID` from `@/executor/constants`. */
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

/** `MAX_STORAGE_KEY_NAME_BYTES` from `@/lib/uploads/core/storage-key` (255 − sidecar suffix). */
const MAX_STORAGE_KEY_NAME_BYTES = 255 - '.upload-metadata.json'.length
const MAX_PRESERVED_EXTENSION_LENGTH = 16

let uniqueKeyCounter = 0
let fileIdCounter = 0

function sanitizeFileName(fileName: string | null | undefined): string {
  if (!fileName || typeof fileName !== 'string') return 'untitled'
  return fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
}

function buildStorageKeySegment(fileName: string): string {
  const safeName = sanitizeFileName(fileName)
  const budget = MAX_STORAGE_KEY_NAME_BYTES
  if (safeName.length <= budget) return safeName
  const dotIndex = safeName.lastIndexOf('.')
  const extension = dotIndex > 0 ? safeName.slice(dotIndex) : ''
  if (extension.length === 0 || extension.length > MAX_PRESERVED_EXTENSION_LENGTH) {
    return safeName.slice(0, budget)
  }
  return safeName.slice(0, budget - extension.length) + extension
}

/**
 * Controllable mock functions for `@/lib/uploads/contexts/execution`.
 *
 * The storage I/O functions (`uploadExecutionFile`, `downloadExecutionFile`,
 * `uploadFileFromRawData`) are bare `vi.fn()`. The key helpers are faithful ports:
 * - `mockGenerateLargeValuePayloadKey` → `execution/<ws>/<wf>/<exec>/large-value-<id>.json`.
 * - `mockGenerateUniqueExecutionFileKey` → `execution/<ws>/<wf>/<exec>/unique-<n>/<safe name>`
 *   (a sequential uniquifier instead of `generateId()`).
 * - `mockGenerateFileId` → `file_<Date.now()>_<n>` (sequential suffix instead of random).
 * - `mockIsExecutionFile` → the real key-pattern check (UUID workspace/workflow/execution ids).
 *
 * @example
 * ```ts
 * import { uploadsExecutionMockFns } from '@sim/testing/mocks/uploads-execution.mock'
 *
 * uploadsExecutionMockFns.mockUploadExecutionFile.mockResolvedValue(userFile)
 * ```
 */
export const uploadsExecutionMockFns = {
  mockUploadExecutionFile: vi.fn(),
  mockDownloadExecutionFile: vi.fn(),
  mockUploadFileFromRawData: vi.fn(),
  mockGenerateLargeValuePayloadKey: vi.fn(
    ({ workspaceId, workflowId, executionId }: MockExecutionContext, id: string): string =>
      `execution/${workspaceId}/${workflowId}/${executionId}/${buildStorageKeySegment(`large-value-${id}.json`)}`
  ),
  mockGenerateUniqueExecutionFileKey: vi.fn(
    ({ workspaceId, workflowId, executionId }: MockExecutionContext, fileName: string): string => {
      uniqueKeyCounter += 1
      return `execution/${workspaceId}/${workflowId}/${executionId}/unique-${uniqueKeyCounter}/${buildStorageKeySegment(fileName)}`
    }
  ),
  mockGenerateFileId: vi.fn((): string => {
    fileIdCounter += 1
    return `file_${Date.now()}_${fileIdCounter}`
  }),
  mockIsExecutionFile: vi.fn((file: { key?: string | null }): boolean => {
    const key = file.key
    if (!key || key.startsWith('/api/') || key.startsWith('http')) return false
    const parts = key.split('/')
    if (parts[0] !== 'execution' || parts.length < 5) return false
    return UUID_RE.test(parts[1]) && UUID_RE.test(parts[2]) && UUID_RE.test(parts[3])
  }),
}

/**
 * Static mock module for `@/lib/uploads/contexts/execution`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)
 * ```
 */
export const uploadsExecutionMock = {
  uploadExecutionFile: uploadsExecutionMockFns.mockUploadExecutionFile,
  downloadExecutionFile: uploadsExecutionMockFns.mockDownloadExecutionFile,
  uploadFileFromRawData: uploadsExecutionMockFns.mockUploadFileFromRawData,
  generateLargeValuePayloadKey: uploadsExecutionMockFns.mockGenerateLargeValuePayloadKey,
  generateUniqueExecutionFileKey: uploadsExecutionMockFns.mockGenerateUniqueExecutionFileKey,
  generateFileId: uploadsExecutionMockFns.mockGenerateFileId,
  isExecutionFile: uploadsExecutionMockFns.mockIsExecutionFile,
}
