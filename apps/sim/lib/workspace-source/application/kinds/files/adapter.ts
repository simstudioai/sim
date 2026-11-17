/**
 * Workspace files as source: every file under `files/` is one workspace file at that folder path
 * and name, synced by SHA-256 through the blob rounds. Creates go through
 * `createWorkspaceFileBufferByPath` (which creates missing folders), content changes through
 * `updateWorkspaceFileContentFromBuffer` guarded by the revision the plan saw (each one records a
 * new version), deletes through `deleteWorkspaceFileOperation` (Recently Deleted keeps the file).
 * Only `context = 'workspace'` files are read; a file over the blob cap, or one whose path no
 * directory can hold, is left out of a get and never touched by an apply. A path is the key, so a
 * file moved or deleted in the Files tab is recognized by the id its base entry names and never
 * created again at the old path.
 */
import { sha256Hex } from '@sim/security/hash'
import {
  type BaseResource,
  fingerprintOf,
  type ResourceFingerprint,
  resourceAddress,
} from '@sim/workspace-code'
import {
  type FileDecl,
  fileBlobPath,
  fileCodec,
  fileKeyConflicts,
  filePathProblem,
} from '@sim/workspace-code/kinds/files'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { resolveEffectiveMimeType } from '@/lib/uploads/utils/file'
import { encodeVfsPathSegments, normalizeDisplaySegment } from '@/lib/vfs/path'
import { admitCreateWorkspaceFile } from '@/lib/workspace-files/application/create-workspace-file'
import { deleteWorkspaceFileOperation } from '@/lib/workspace-files/application/delete-workspace-file'
import {
  queryWorkspaceFilePage,
  readWorkspaceFileContentStates,
  type WorkspaceFileContentState,
} from '@/lib/workspace-files/application/list-workspace-files'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import {
  admitUpdateWorkspaceFileContent,
  updateWorkspaceFileContentFromBuffer,
} from '@/lib/workspace-files/application/update-workspace-file-content'
import { createWorkspaceFileBufferByPath } from '@/lib/workspace-files/application/write-workspace-file-by-path'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'
import { ResourceChangedError } from '@/lib/workspace-source/application/errors'
import {
  noBaseFinding,
  planUndeclared,
  serverChangedFinding,
  staleFinding,
} from '@/lib/workspace-source/application/findings'
import { resolveDeclared } from '@/lib/workspace-source/application/three-way'
import type {
  AppliedResource,
  ApplyContext,
  KindAdapter,
  PlanContext,
  PlannedChange,
  SourceContext,
  StoredResource,
  StoredSet,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'

/** Why a directory never holds a stored file, as the code a declaration of it is refused with. */
interface Unmanaged {
  code: 'E_FILE_TOO_LARGE' | 'E_FILE_PATH' | 'E_FILE_PATH_COLLISION'
  reason: string
}

/** One stored workspace file, keyed by its path under `files/`. */
interface StoredFileState {
  size: number
  rev: string
  /** SHA-256 of the current bytes when version history records it. */
  sha256: string | null
  unmanaged?: Unmanaged
}

type StoredFile = StoredResource<StoredFileState>

/** The content revision the plan saw; the write refuses a file that moved past it. */
interface FilePlan {
  rev: string
}

type FileChange = PlannedChange<FileDecl, FilePlan>

/**
 * A stored file's path under `files/` (its folder names, then its name), and why no directory can
 * hold it when a folder or file name has a slash in it, or its folder path cannot be read.
 */
function storedPath(file: WorkspaceFileRecord): { key: string; problem: string | null } {
  let segments: string[]
  try {
    segments = [...parseWorkspaceFileFolderDisplayPath(file.folderPath ?? ''), file.name]
  } catch {
    return { key: `${file.folderPath}/${file.name}`, problem: 'its folder path cannot be read' }
  }
  const key = segments.join('/')
  const slashed = segments.find((segment) => segment.includes('/'))
  return {
    key,
    problem: slashed === undefined ? filePathProblem(key) : `"${slashed}" has a slash in its name`,
  }
}

function fingerprint(sha256: string): ResourceFingerprint {
  return fingerprintOf(fileCodec.canonical({ sha256, size: 0 }))
}

/**
 * A file's base entry: its id and fingerprint, plus the revision and hash it was read at under its
 * blob path, so a later plan knows the server's bytes are unchanged even without a stored hash.
 */
function fileBase(key: string, id: string, rev: string, sha256: string): BaseResource {
  return {
    id,
    fingerprint: fingerprint(sha256),
    blobs: { [fileBlobPath(key)]: { id, rev, sha256 } },
  }
}

/** The revision the base recorded for a file, as a string. */
function baseRev(key: string, base?: BaseResource): string | undefined {
  const rev = base?.blobs?.[fileBlobPath(key)]?.rev
  return rev === undefined ? undefined : String(rev)
}

/** The hash the server holds: its own, or the base's when the revision has not moved since. */
function serverSha(file: StoredFile, base?: BaseResource): string | null {
  if (file.state.sha256 !== null) return file.state.sha256
  const recorded = base?.blobs?.[fileBlobPath(file.key)]
  return recorded && recorded.id === file.id && String(recorded.rev) === file.state.rev
    ? recorded.sha256
    : null
}

/** Reads a stored file's bytes, under the content read's own authorization. */
async function storedBytes(ctx: SourceContext, fileId: string): Promise<Buffer> {
  const { content } = await readWorkspaceFileContent.execute({
    principal: ctx.principal,
    input: {
      fileId,
      assertedWorkspaceId: ctx.workspace.workspaceId,
      contentView: 'opaque',
      maxBytes: WORKSPACE_SOURCE_LIMITS.maxBlobBytes,
    },
  })
  return content
}

/** Stored bytes each request may still read to hash files whose hash nothing records. */
const hashBudgets = new WeakMap<SourceContext, { bytes: number }>()

/**
 * Takes `size` bytes from the request's hashing budget (`maxBlobBytesPerRequest`), or returns
 * `false` when they do not fit. Uploads record no hash, so without a bound one get or plan would
 * read and hash every stored byte of the workspace.
 */
function spendHashBudget(ctx: SourceContext, size: number): boolean {
  const budget = hashBudgets.get(ctx) ?? { bytes: WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest }
  hashBudgets.set(ctx, budget)
  if (size > budget.bytes) return false
  budget.bytes -= size
  return true
}

/**
 * Hashes the stored bytes of each declared file whose hash neither the server nor the base
 * records, when its size matches the declared one (only then can the bytes be equal), within the
 * request's hashing budget. Knowing the hash lets an apply whose earlier round wrote the file
 * without saving the base adopt it instead of refusing it. A file past the budget keeps no hash, so it
 * plans as no-base or stale and is never created or deleted.
 */
async function hashUnrecorded(
  ctx: PlanContext,
  desired: ReadonlyMap<string, FileDecl>,
  stored: StoredSet<StoredFileState>
): Promise<void> {
  for (const [key, decl] of desired) {
    const file = stored.bound.get(key)
    if (!file || file.state.unmanaged || file.state.size !== decl.size) continue
    if (serverSha(file, ctx.base?.resources[resourceAddress('file', key)]) !== null) continue
    if (!spendHashBudget(ctx, file.state.size)) continue
    file.state.sha256 = sha256Hex(await storedBytes(ctx, file.id))
  }
}

function finding(
  key: string,
  code: string,
  message: string,
  hint: string
): WorkspaceSourceDiagnostic {
  return { code, severity: 'error', message, hint, file: fileBlobPath(key), kind: 'file', key }
}

function contentStates(
  ctx: SourceContext,
  fileIds: string[]
): Promise<Map<string, WorkspaceFileContentState>> {
  return readWorkspaceFileContentStates.execute({
    principal: ctx.principal,
    input: { workspaceId: ctx.workspace.workspaceId, fileIds },
  })
}

/** One file's revision and hash now, refusing a file that is gone. */
async function stateOf(ctx: SourceContext, fileId: string): Promise<WorkspaceFileContentState> {
  const state = (await contentStates(ctx, [fileId])).get(fileId)
  if (!state) throw new OrchestrationError('not_found', 'The file no longer exists.')
  return state
}

/** A segment the server would store under another name (trimmed, collapsed, NFC), if any. */
function renamedSegment(key: string): string | null {
  for (const segment of key.split('/')) {
    const stored = normalizeDisplaySegment(segment)
    if (stored !== segment) return `"${segment}" would be stored as "${stored}"`
  }
  return null
}

/**
 * A declared file whose base entry names a file no longer stored at its path: moved (or renamed)
 * on the server, or deleted there. Left as the server has it when the local copy is the one the
 * base recorded, stale otherwise; never created again at the old path.
 */
function planGone(
  change: FileChange,
  decl: FileDecl,
  base: BaseResource,
  byId: ReadonlyMap<string, StoredFile>
): FileChange {
  const moved = byId.get(base.id)
  const where = fileBlobPath(change.key)
  if (base.fingerprint === fingerprint(decl.sha256)) {
    change.diagnostics.push({
      ...serverChangedFinding('file', change.key),
      message: moved
        ? `${where} was moved on the server to ${fileBlobPath(moved.key)}; this directory leaves it there, and the next get shows the move.`
        : `${where} was deleted on the server; this directory does not create it again, and the next get drops it.`,
    })
    return change
  }
  change.diagnostics.push({
    ...staleFinding('file', change.key),
    message: moved
      ? `${where} was moved on the server to ${fileBlobPath(moved.key)} since this directory was read.`
      : `${where} was deleted on the server since this directory was read.`,
  })
  return change
}

function planFile(
  key: string,
  decl: FileDecl,
  stored: StoredSet<StoredFileState>,
  ctx: PlanContext,
  byId: ReadonlyMap<string, StoredFile>
): FileChange {
  const change: FileChange = { kind: 'file', key, action: 'noop', decl, diagnostics: [] }
  const existing = stored.bound.get(key)
  const base = ctx.base?.resources[resourceAddress('file', key)]
  if (!existing && base) return planGone(change, decl, base, byId)
  if (existing?.state.unmanaged) {
    change.diagnostics.push(
      finding(
        key,
        existing.state.unmanaged.code,
        `${fileBlobPath(key)} on the server is never written by source: ${existing.state.unmanaged.reason}.`,
        'Remove it from files/ and change it in the Files tab.'
      )
    )
    return { ...change, storedId: existing.id }
  }
  const resolution = resolveDeclared({
    local: fingerprint(decl.sha256),
    stored: existing,
    base,
    fingerprint: (file, base) => {
      const sha = serverSha(file, base)
      return sha === null ? `unknown:${file.state.rev}` : fingerprint(sha)
    },
  })
  switch (resolution.action) {
    case 'stale':
      change.diagnostics.push(staleFinding('file', key))
      return { ...change, storedId: resolution.stored.id }
    case 'no-base':
      change.diagnostics.push(noBaseFinding('file', key))
      return { ...change, storedId: resolution.stored.id }
    case 'noop': {
      const { state, id } = resolution.stored
      if (resolution.serverChanged) change.diagnostics.push(serverChangedFinding('file', key))
      return {
        ...change,
        storedId: id,
        ...(resolution.refreshed ? { base: fileBase(key, id, state.rev, decl.sha256) } : {}),
      }
    }
    case 'update':
      return {
        ...change,
        action: 'update',
        storedId: resolution.stored.id,
        fields: [`bytes (${resolution.stored.state.size} → ${decl.size})`],
        needsBlobs: [fileBlobPath(key)],
        detail: { rev: resolution.stored.state.rev },
      }
    case 'adopt':
    case 'create': {
      const renamed = renamedSegment(key)
      if (renamed !== null) {
        change.diagnostics.push(
          finding(
            key,
            'E_FILE_NAME',
            `${fileBlobPath(key)} cannot be created under this name: ${renamed}.`,
            'Rename it locally to the name the server would store.'
          )
        )
      }
      return {
        ...change,
        action: 'create',
        fields: [`bytes (${decl.size})`],
        needsBlobs: [fileBlobPath(key)],
      }
    }
  }
}

/**
 * Files the server holds that the directory no longer declares: only one the base records is
 * deleted, only with `--allow-delete`, and only while its bytes are the ones the base recorded.
 */
function planDeletes(
  desired: ReadonlyMap<string, FileDecl>,
  stored: StoredSet<StoredFileState>,
  ctx: PlanContext
): FileChange[] {
  const managed: StoredSet<StoredFileState> = {
    bound: new Map([...stored.bound].filter(([, file]) => !file.state.unmanaged)),
    unbound: [],
  }
  const undeclared = planUndeclared<StoredFileState, FileDecl, FilePlan>(
    'file',
    desired,
    managed,
    ctx,
    (file) => ({ what: 'file', counts: { files: 1, bytes: file.state.size } })
  )
  return undeclared.map((change) => {
    const file = managed.bound.get(change.key)
    if (change.action !== 'delete' || !file) return change
    if (
      baseRev(change.key, ctx.base?.resources[resourceAddress('file', change.key)]) !==
      file.state.rev
    ) {
      return { ...change, action: 'noop', diagnostics: [staleFinding('file', change.key)] }
    }
    return { ...change, detail: { rev: file.state.rev } }
  })
}

/**
 * Refuses a create whose path a case-insensitive disk would merge with a file or folder the server
 * keeps, so the next get never has to leave one of them out. A stored file this apply deletes
 * keeps no path, so a case-only rename (create `Report.pdf`, delete `report.pdf`) goes through.
 */
function refuseCollisions(
  files: readonly FileChange[],
  stored: StoredSet<StoredFileState>,
  deletes: readonly FileChange[]
): void {
  const deleted = new Set(
    deletes.filter((change) => change.action === 'delete').map((change) => change.key)
  )
  const creates = new Map(
    files.filter((change) => change.action === 'create').map((change) => [change.key, change])
  )
  const kept = [...stored.bound.keys()].filter((key) => !deleted.has(key))
  for (const [key, conflict] of fileKeyConflicts([...kept, ...creates.keys()])) {
    creates
      .get(key)
      ?.diagnostics.push(
        finding(
          key,
          'E_FILE_PATH_COLLISION',
          `${conflict} on the server.`,
          'Use the server’s spelling, or delete the server’s file in this apply (--allow-delete).'
        )
      )
  }
}

/** The bytes a write sends, refused unless they are the ones the directory declared. */
function contentOf(change: FileChange, ctx: ApplyContext): Buffer {
  const bytes = ctx.blobs.get(fileBlobPath(change.key))
  if (!change.decl || !bytes) throw new Error('A file write needs its declaration and bytes')
  if (bytes.length !== change.decl.size || sha256Hex(bytes) !== change.decl.sha256) {
    throw new OrchestrationError(
      'validation',
      `${fileBlobPath(change.key)} does not match the hash it was declared with; it changed while it was sent.`
    )
  }
  return bytes
}

/** The base entry of a file just written, from what the server recorded. */
async function written(
  ctx: SourceContext,
  key: string,
  fileId: string,
  sha256: string
): Promise<AppliedResource> {
  const state = await stateOf(ctx, fileId)
  return { id: fileId, base: fileBase(key, fileId, state.rev, state.sha256 ?? sha256), text: {} }
}

export const fileAdapter: KindAdapter<FileDecl, StoredFileState, FilePlan> = {
  codec: fileCodec,

  async load(ctx) {
    const { workspaceId } = ctx.workspace
    const { maxResourcesPerKind, maxBlobBytes } = WORKSPACE_SOURCE_LIMITS
    const { files } = await queryWorkspaceFilePage.execute({
      principal: ctx.principal,
      input: {
        workspaceId,
        sortBy: 'uploadedAt',
        sortOrder: 'asc',
        limit: maxResourcesPerKind + 1,
      },
    })
    if (files.length > maxResourcesPerKind) {
      throw new OrchestrationError(
        'payload_too_large',
        `This workspace has more than ${maxResourcesPerKind} files, more than one directory holds. Leave files/ out with --only.`
      )
    }
    const states = await contentStates(
      ctx,
      files.map((file) => file.id)
    )
    const set: StoredSet<StoredFileState> = { bound: new Map(), unbound: [] }
    for (const file of files) {
      const content = states.get(file.id)
      const { key, problem } = storedPath(file)
      if (!content || (set.bound.has(key) && !set.bound.get(key)?.state.unmanaged)) continue
      const unmanaged: Unmanaged | undefined =
        file.size > maxBlobBytes
          ? {
              code: 'E_FILE_TOO_LARGE',
              reason: `it is ${file.size} bytes, over the ${maxBlobBytes}-byte limit`,
            }
          : problem !== null
            ? { code: 'E_FILE_PATH', reason: `no directory can hold its path: ${problem}` }
            : undefined
      set.bound.set(key, {
        key,
        id: file.id,
        name: key,
        state: {
          size: file.size,
          rev: content.rev,
          sha256: content.sha256,
          ...(unmanaged ? { unmanaged } : {}),
        },
      })
    }
    const held = [...set.bound.values()].filter((file) => !file.state.unmanaged)
    for (const [key, reason] of fileKeyConflicts(held.map((file) => file.key))) {
      const file = set.bound.get(key)
      if (file) file.state.unmanaged = { code: 'E_FILE_PATH_COLLISION', reason }
    }
    return set
  },

  async plan(desired, stored, ctx) {
    await hashUnrecorded(ctx, desired, stored)
    const byId = new Map([...stored.bound.values()].map((file) => [file.id, file]))
    const files = [...desired].map(([key, decl]) => planFile(key, decl, stored, ctx, byId))
    const deletes = planDeletes(desired, stored, ctx)
    refuseCollisions(files, stored, deletes)
    return [...files, ...deletes]
  },

  async authorize(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    if (change.action === 'create') {
      await admitCreateWorkspaceFile(principal, workspaceId)
      return
    }
    if (!change.storedId) return
    if (change.action === 'delete') {
      await deleteWorkspaceFileOperation.authorize({
        principal,
        input: { fileId: change.storedId, assertedWorkspaceId: workspaceId },
      })
      return
    }
    await admitUpdateWorkspaceFileContent(principal, change.storedId)
  },

  async apply(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    if (change.action === 'delete') {
      const fileId = change.storedId
      if (!fileId || !change.detail) throw new Error('A file delete needs its plan')
      if ((await stateOf(ctx, fileId)).rev !== change.detail.rev) {
        throw new ResourceChangedError(change)
      }
      await deleteWorkspaceFileOperation.execute({
        principal,
        input: { fileId, assertedWorkspaceId: workspaceId },
      })
      return { id: fileId, text: {} }
    }
    const content = contentOf(change, ctx)
    const sha256 = sha256Hex(content)
    if (change.action === 'create') {
      const segments = change.key.split('/')
      const created = await createWorkspaceFileBufferByPath.execute({
        principal,
        input: {
          workspaceId,
          path: fileBlobPath(encodeVfsPathSegments(segments)),
          content,
          contentType: resolveEffectiveMimeType(undefined, segments[segments.length - 1] ?? ''),
          mode: 'create',
          exactName: true,
        },
      })
      return written(ctx, change.key, created.id, sha256)
    }
    const fileId = change.storedId
    if (!fileId || !change.detail) throw new Error('A file update needs its plan')
    try {
      await updateWorkspaceFileContentFromBuffer.execute({
        principal,
        input: {
          fileId,
          assertedWorkspaceId: workspaceId,
          content,
          provenanceMode: 'replace_empty',
          expectedUpdatedAt: new Date(change.detail.rev),
        },
      })
    } catch (error) {
      if (error instanceof OrchestrationError && error.code === 'conflict') {
        throw new ResourceChangedError(change)
      }
      throw error
    }
    return written(ctx, change.key, fileId, sha256)
  },

  async read(stored, ctx) {
    const { state, id, key } = stored
    if (state.unmanaged) {
      throw new OrchestrationError(
        state.unmanaged.code === 'E_FILE_TOO_LARGE' ? 'payload_too_large' : 'validation',
        `${fileBlobPath(key)} is left out: ${state.unmanaged.reason}.`
      )
    }
    const workspaceId = ctx.workspace.workspaceId
    let { sha256, size } = state
    if (sha256 === null && spendHashBudget(ctx, size)) {
      const content = await storedBytes(ctx, id)
      sha256 = sha256Hex(content)
      size = content.length
    }
    const href = `/api/v2/files/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`
    if (sha256 === null) {
      return {
        text: {},
        blobs: [{ path: fileBlobPath(key), size, id, href, rev: state.rev }],
        base: { id },
      }
    }
    return {
      text: {},
      blobs: [{ path: fileBlobPath(key), sha256, size, id, href }],
      base: fileBase(key, id, state.rev, sha256),
    }
  },
}
