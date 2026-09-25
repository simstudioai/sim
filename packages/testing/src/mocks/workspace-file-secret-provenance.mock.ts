import { vi } from 'vitest'

const PROVENANCE_MAX_SERIALIZED_BYTES = 8 * 1024 * 1024
const PROVENANCE_MAX_ENTRIES = 10_000

/** Structural stand-in for `WorkspaceFileSecretProvenanceEntry`. */
interface MockSecretProvenanceEntry {
  encryptedValue: string
  sourceUserId: string
  sourceWorkspaceId?: string | null
  name?: string
}

/** Structural stand-in for `WorkspaceFileSecretProvenance`. */
type MockSecretProvenance =
  | { status: 'exact'; entries: readonly MockSecretProvenanceEntry[] }
  | { status: 'unknown' }
  | { status: 'unrecorded' }

function entryByteSize(entry: MockSecretProvenanceEntry): number {
  return (
    Buffer.byteLength(entry.sourceUserId, 'utf8') +
    Buffer.byteLength(entry.sourceWorkspaceId ?? '', 'utf8') +
    Buffer.byteLength(entry.name ?? '', 'utf8') +
    Buffer.byteLength(entry.encryptedValue, 'utf8')
  )
}

/** Faithful port of the real merge (pure; limits copied from `provenance-limits`). */
function mergeWorkspaceFileSecretProvenance(
  ...provenances: readonly MockSecretProvenance[]
): MockSecretProvenance {
  if (provenances.some((provenance) => provenance.status === 'unknown')) {
    return { status: 'unknown' }
  }
  if (provenances.some((provenance) => provenance.status === 'unrecorded')) {
    return provenances.some(
      (provenance) => provenance.status === 'exact' && provenance.entries.length > 0
    )
      ? { status: 'unknown' }
      : { status: 'unrecorded' }
  }
  const entries = new Map<string, MockSecretProvenanceEntry>()
  let bytes = 0
  for (const provenance of provenances) {
    if (provenance.status !== 'exact') continue
    for (const entry of provenance.entries) {
      if (
        !entry.encryptedValue ||
        !entry.sourceUserId ||
        (entry.name !== undefined && entry.name.length === 0)
      ) {
        return { status: 'unknown' }
      }
      const size = entryByteSize(entry)
      if (size > PROVENANCE_MAX_SERIALIZED_BYTES) return { status: 'unknown' }
      const key = JSON.stringify([
        entry.sourceUserId,
        entry.sourceWorkspaceId ?? '',
        entry.name ?? '',
        entry.encryptedValue,
      ])
      if (entries.has(key)) continue
      bytes += size
      if (entries.size >= PROVENANCE_MAX_ENTRIES || bytes > PROVENANCE_MAX_SERIALIZED_BYTES) {
        return { status: 'unknown' }
      }
      entries.set(key, entry)
    }
  }
  return { status: 'exact', entries: [...entries.values()] }
}

/**
 * Controllable mock functions for
 * `@/lib/uploads/contexts/workspace/workspace-file-secret-provenance`.
 *
 * Every DB-backed function is a bare `vi.fn()` — including the safety predicates
 * (`isModelSafeWorkspaceFileKey`, `areModelSafeWorkspaceFileKeys`,
 * `isOpaqueWorkspaceFileEgressSafe`), which therefore resolve `undefined` (falsy, i.e.
 * "unsafe") until a test sets them. `mergeWorkspaceFileSecretProvenance` is a faithful port.
 *
 * @example
 * ```ts
 * import { workspaceFileSecretProvenanceMockFns } from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
 *
 * workspaceFileSecretProvenanceMockFns.mockIsOpaqueWorkspaceFileEgressSafe.mockResolvedValue(true)
 * ```
 */
export const workspaceFileSecretProvenanceMockFns = {
  mockMergeWorkspaceFileSecretProvenance: vi.fn(mergeWorkspaceFileSecretProvenance),
  mockCreateWorkspaceFileSecretProvenanceFromRegistry: vi.fn(),
  mockReplaceWorkspaceFileSecretProvenanceInTx: vi.fn(),
  mockInitializeWorkspaceFileSecretProvenanceInTx: vi.fn(),
  mockPreserveWorkspaceFileSecretProvenanceInTx: vi.fn(),
  mockSnapshotWorkspaceFileSecretProvenanceInTx: vi.fn(),
  mockApplyWorkspaceFileSecretProvenancePolicyInTx: vi.fn(),
  mockCopyWorkspaceFileSecretProvenanceInTx: vi.fn(),
  mockMarkWorkspaceFileSecretProvenanceUnknown: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenance: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenanceByMetadata: vi.fn(),
  mockImportWorkspaceFileSecretProvenanceForModelView: vi.fn(),
  mockIsOpaqueWorkspaceFileEgressSafe: vi.fn(),
  mockImportWorkspaceFileSecretProvenanceForRuntime: vi.fn(),
  mockImportWorkspaceFileSnapshotProvenance: vi.fn(),
  mockFilterModelSafeWorkspaceFileAttachments: vi.fn(),
  mockIsModelSafeWorkspaceFileKey: vi.fn(),
  mockAreModelSafeWorkspaceFileKeys: vi.fn(),
}

const fns = workspaceFileSecretProvenanceMockFns

/**
 * Static mock module for
 * `@/lib/uploads/contexts/workspace/workspace-file-secret-provenance`. Constants carry the
 * real values.
 *
 * @example
 * ```ts
 * vi.mock(
 *   '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
 *   () => workspaceFileSecretProvenanceMock
 * )
 * ```
 */
export const workspaceFileSecretProvenanceMock = {
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
  EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE: Object.freeze({
    status: 'exact' as const,
    entries: Object.freeze([]),
  }),
  mergeWorkspaceFileSecretProvenance: fns.mockMergeWorkspaceFileSecretProvenance,
  createWorkspaceFileSecretProvenanceFromRegistry:
    fns.mockCreateWorkspaceFileSecretProvenanceFromRegistry,
  replaceWorkspaceFileSecretProvenanceInTx: fns.mockReplaceWorkspaceFileSecretProvenanceInTx,
  initializeWorkspaceFileSecretProvenanceInTx: fns.mockInitializeWorkspaceFileSecretProvenanceInTx,
  preserveWorkspaceFileSecretProvenanceInTx: fns.mockPreserveWorkspaceFileSecretProvenanceInTx,
  snapshotWorkspaceFileSecretProvenanceInTx: fns.mockSnapshotWorkspaceFileSecretProvenanceInTx,
  applyWorkspaceFileSecretProvenancePolicyInTx:
    fns.mockApplyWorkspaceFileSecretProvenancePolicyInTx,
  copyWorkspaceFileSecretProvenanceInTx: fns.mockCopyWorkspaceFileSecretProvenanceInTx,
  markWorkspaceFileSecretProvenanceUnknown: fns.mockMarkWorkspaceFileSecretProvenanceUnknown,
  getBoundWorkspaceFileSecretProvenance: fns.mockGetBoundWorkspaceFileSecretProvenance,
  getBoundWorkspaceFileSecretProvenanceByMetadata:
    fns.mockGetBoundWorkspaceFileSecretProvenanceByMetadata,
  importWorkspaceFileSecretProvenanceForModelView:
    fns.mockImportWorkspaceFileSecretProvenanceForModelView,
  isOpaqueWorkspaceFileEgressSafe: fns.mockIsOpaqueWorkspaceFileEgressSafe,
  importWorkspaceFileSecretProvenanceForRuntime:
    fns.mockImportWorkspaceFileSecretProvenanceForRuntime,
  importWorkspaceFileSnapshotProvenance: fns.mockImportWorkspaceFileSnapshotProvenance,
  filterModelSafeWorkspaceFileAttachments: fns.mockFilterModelSafeWorkspaceFileAttachments,
  isModelSafeWorkspaceFileKey: fns.mockIsModelSafeWorkspaceFileKey,
  areModelSafeWorkspaceFileKeys: fns.mockAreModelSafeWorkspaceFileKeys,
}
