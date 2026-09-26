import { vi } from 'vitest'

const WORKSPACE_KEY_PATTERN = /^workspace\/([a-f0-9-]{36})\/(\d+)-([a-z0-9]+)-(.+)$/
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

/** Structural stand-in for the path fields of `WorkspaceFileRecord`. */
interface MockWorkspaceFilePathFields {
  folderPath?: string | null
  name: string
  vfsNamespace?: 'files' | 'recently-deleted/files' | 'uploads'
}

/** Structural stand-in for the lookup fields of `WorkspaceFileRecord`. */
interface MockWorkspaceFileLookupFields {
  id: string
  name: string
  folderPath?: string | null
}

/**
 * Real `FileConflictError` stand-in: same `name`, `code: 'conflict'` and message.
 * It extends `Error`, not the app's `OrchestrationError`, so `instanceof OrchestrationError`
 * is false for it; code under test that branches on that needs a local class.
 */
export class MockFileConflictError extends Error {
  readonly code = 'conflict' as const

  constructor(name: string) {
    super(`A file named "${name}" already exists in this workspace`)
    this.name = 'FileConflictError'
  }
}

/** Real `ContentVersionConflictError` stand-in: same `name`, `fileId` and message. */
export class MockContentVersionConflictError extends Error {
  constructor(readonly fileId: string) {
    super(`Workspace file ${fileId} changed since it was read (optimistic-concurrency conflict)`)
    this.name = 'ContentVersionConflictError'
  }
}

/** Real `WorkspaceFileKeyOwnershipError` stand-in: same `code` and message. */
export class MockWorkspaceFileKeyOwnershipError extends Error {
  readonly code = 'KEY_NOT_OWNED' as const

  constructor(key: string) {
    super(`Storage key is not available for a chat attachment: ${key}`)
  }
}

function matchesWorkspaceFilePattern(key: string): boolean {
  if (!key || key.startsWith('/api/') || key.startsWith('http')) return false
  return WORKSPACE_KEY_PATTERN.test(key)
}

function withCopySuffix(fileName: string, n: number): string {
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot > 0 && lastDot < fileName.length - 1) {
    return `${fileName.slice(0, lastDot)} (${n})${fileName.slice(lastDot)}`
  }
  return `${fileName} (${n})`
}

function decodeSegments(path: string): string[] {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? trimmed.split('/').map((segment) => decodeURIComponent(segment)) : []
}

function referenceSegments(fileReference: string): string[] {
  const trimmed = fileReference.trim().replace(/^\/+/, '')
  const withoutDeleted = trimmed.startsWith('recently-deleted/')
    ? trimmed.slice('recently-deleted/'.length)
    : trimmed
  if (!withoutDeleted.startsWith('files/')) return decodeSegments(withoutDeleted)
  const withoutPrefix = withoutDeleted.slice('files/'.length)
  if (withoutPrefix.endsWith('/meta.json')) {
    return decodeSegments(withoutPrefix.slice(0, -'/meta.json'.length))
  }
  if (withoutPrefix.endsWith('/content')) {
    return decodeSegments(withoutPrefix.slice(0, -'/content'.length))
  }
  return decodeSegments(withoutPrefix)
}

function vfsPath(file: MockWorkspaceFilePathFields): string {
  const prefix = file.vfsNamespace ?? 'files'
  const folderSegments = file.folderPath ? file.folderPath.split('/') : []
  return `${prefix}/${[...folderSegments, file.name].map((s) => encodeURIComponent(s)).join('/')}`
}

/**
 * Controllable mock functions for
 * `@/lib/uploads/contexts/workspace/workspace-file-manager` (also spread into
 * `workspaceUploadsMock` for the `@/lib/uploads/contexts/workspace` barrel, so both import
 * paths share these `vi.fn()`s).
 *
 * I/O functions are bare `vi.fn()`s. Pure helpers default to ports of the real logic:
 * `matchesWorkspaceFilePattern`, `parseWorkspaceFileKey`, `suffixedName` are faithful;
 * the VFS helpers (`normalizeWorkspaceFileReference`, `workspaceFileVfsPath`,
 * `getSandboxWorkspaceFilePath`, `parseChatUploadReference`, `findWorkspaceFileRecord`)
 * percent-encode with `encodeURIComponent` and split folder paths on `/` (no escaped-slash
 * folder names). `generateWorkspaceFileKey` is deterministic —
 * `workspace/{workspaceId}/generated-{fileName}` — which `parseWorkspaceFileKey` does
 * not recognize (no timestamp/random segment).
 *
 * @example
 * ```ts
 * import { workspaceFileManagerMockFns } from '@sim/testing/mocks/workspace-file-manager.mock'
 *
 * workspaceFileManagerMockFns.mockGetWorkspaceFile.mockResolvedValue({ id: 'file-1', name: 'a.txt' })
 * ```
 */
export const workspaceFileManagerMockFns = {
  mockMatchesWorkspaceFilePattern: vi.fn(matchesWorkspaceFilePattern),
  mockParseWorkspaceFileKey: vi.fn((key: string): string | null => {
    if (!matchesWorkspaceFilePattern(key)) return null
    const workspaceId = key.match(WORKSPACE_KEY_PATTERN)?.[1]
    return workspaceId && UUID_PATTERN.test(workspaceId) ? workspaceId : null
  }),
  mockGenerateWorkspaceFileKey: vi.fn(
    (workspaceId: string, fileName: string) => `workspace/${workspaceId}/generated-${fileName}`
  ),
  mockAllocateUniqueWorkspaceFileName: vi.fn(),
  mockUploadWorkspaceFile: vi.fn(),
  mockRegisterUploadedWorkspaceFile: vi.fn(),
  mockSuffixedName: vi.fn((name: string, n: number) => (n <= 1 ? name : withCopySuffix(name, n))),
  mockTrackChatUpload: vi.fn(),
  mockFileExistsInWorkspace: vi.fn(),
  mockUpdateWorkspaceFileDimensions: vi.fn(),
  mockGetWorkspaceFileByName: vi.fn(),
  mockListWorkspaceFiles: vi.fn(),
  mockQueryWorkspaceFiles: vi.fn(),
  mockNormalizeWorkspaceFileReference: vi.fn((fileReference: string) =>
    referenceSegments(fileReference).join('/')
  ),
  mockWorkspaceFileVfsPath: vi.fn(vfsPath),
  mockGetSandboxWorkspaceFilePath: vi.fn(
    (file: MockWorkspaceFilePathFields) => `/home/user/${vfsPath(file)}`
  ),
  mockParseChatUploadReference: vi.fn((fileReference: string): string | null => {
    const trimmed = fileReference.trim().replace(/^\/+/, '')
    if (!trimmed.startsWith('uploads/')) return null
    const segments = decodeSegments(trimmed)
    return segments.length === 2 ? segments[1] : null
  }),
  mockFindWorkspaceFileRecord: vi.fn(
    <T extends MockWorkspaceFileLookupFields>(files: T[], fileReference: string): T | null => {
      const exact = files.find((file) => file.id === fileReference)
      if (exact) return exact
      const segments = referenceSegments(fileReference)
      const normalized = segments.join('/')
      const byId = files.find((file) => file.id === normalized)
      if (byId) return byId
      const segmentKey = segments.map((s) => encodeURIComponent(s)).join('/')
      return (
        files.find((file) => vfsPath(file).slice('files/'.length) === segmentKey) ??
        files.find((file) => encodeURIComponent(file.name) === segmentKey) ??
        null
      )
    }
  ),
  mockResolveWorkspaceFileReference: vi.fn(),
  mockLoadActiveWorkspaceFileContext: vi.fn(),
  mockLoadWorkspaceFileLifecycleContext: vi.fn(),
  mockLoadActiveWorkspaceContext: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockGetWorkspaceFileWithCurrentVersion: vi.fn(),
  mockGetWorkspaceFileVersionsByKey: vi.fn(),
  mockFetchServableWorkspaceFileBuffer: vi.fn(),
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockUpdateWorkspaceFileContent: vi.fn(),
  mockDeleteWorkspaceFileVersion: vi.fn(),
  mockRenameWorkspaceFile: vi.fn(),
  mockMoveRenameWorkspaceFile: vi.fn(),
  mockDeleteWorkspaceFile: vi.fn(),
  mockPurgeCreatedWorkspaceFile: vi.fn(),
  mockRestoreWorkspaceFile: vi.fn(),
}

const fns = workspaceFileManagerMockFns

/**
 * Static mock module for `@/lib/uploads/contexts/workspace/workspace-file-manager`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)
 * ```
 */
export const workspaceFileManagerMock = {
  CHAT_DISPLAY_NAME_INDEX: 'workspace_files_chat_display_name_unique',
  FileConflictError: MockFileConflictError,
  ContentVersionConflictError: MockContentVersionConflictError,
  WorkspaceFileKeyOwnershipError: MockWorkspaceFileKeyOwnershipError,
  matchesWorkspaceFilePattern: fns.mockMatchesWorkspaceFilePattern,
  parseWorkspaceFileKey: fns.mockParseWorkspaceFileKey,
  generateWorkspaceFileKey: fns.mockGenerateWorkspaceFileKey,
  allocateUniqueWorkspaceFileName: fns.mockAllocateUniqueWorkspaceFileName,
  uploadWorkspaceFile: fns.mockUploadWorkspaceFile,
  registerUploadedWorkspaceFile: fns.mockRegisterUploadedWorkspaceFile,
  suffixedName: fns.mockSuffixedName,
  trackChatUpload: fns.mockTrackChatUpload,
  fileExistsInWorkspace: fns.mockFileExistsInWorkspace,
  updateWorkspaceFileDimensions: fns.mockUpdateWorkspaceFileDimensions,
  getWorkspaceFileByName: fns.mockGetWorkspaceFileByName,
  listWorkspaceFiles: fns.mockListWorkspaceFiles,
  queryWorkspaceFiles: fns.mockQueryWorkspaceFiles,
  normalizeWorkspaceFileReference: fns.mockNormalizeWorkspaceFileReference,
  workspaceFileVfsPath: fns.mockWorkspaceFileVfsPath,
  getSandboxWorkspaceFilePath: fns.mockGetSandboxWorkspaceFilePath,
  parseChatUploadReference: fns.mockParseChatUploadReference,
  findWorkspaceFileRecord: fns.mockFindWorkspaceFileRecord,
  resolveWorkspaceFileReference: fns.mockResolveWorkspaceFileReference,
  loadActiveWorkspaceFileContext: fns.mockLoadActiveWorkspaceFileContext,
  loadWorkspaceFileLifecycleContext: fns.mockLoadWorkspaceFileLifecycleContext,
  loadActiveWorkspaceContext: fns.mockLoadActiveWorkspaceContext,
  getWorkspaceFile: fns.mockGetWorkspaceFile,
  getWorkspaceFileWithCurrentVersion: fns.mockGetWorkspaceFileWithCurrentVersion,
  getWorkspaceFileVersionsByKey: fns.mockGetWorkspaceFileVersionsByKey,
  fetchServableWorkspaceFileBuffer: fns.mockFetchServableWorkspaceFileBuffer,
  fetchWorkspaceFileBuffer: fns.mockFetchWorkspaceFileBuffer,
  updateWorkspaceFileContent: fns.mockUpdateWorkspaceFileContent,
  deleteWorkspaceFileVersion: fns.mockDeleteWorkspaceFileVersion,
  renameWorkspaceFile: fns.mockRenameWorkspaceFile,
  moveRenameWorkspaceFile: fns.mockMoveRenameWorkspaceFile,
  deleteWorkspaceFile: fns.mockDeleteWorkspaceFile,
  purgeCreatedWorkspaceFile: fns.mockPurgeCreatedWorkspaceFile,
  restoreWorkspaceFile: fns.mockRestoreWorkspaceFile,
}
