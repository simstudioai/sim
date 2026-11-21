/**
 * Workspace files as source: every file under `files/` is one workspace file at that folder path
 * and name, synced by SHA-256 through staged blobs. Creates go through
 * `createWorkspaceFileBufferByPath` (which creates missing folders), content changes through
 * `updateWorkspaceFileContentFromBuffer` guarded by the revision the plan saw (each one records a
 * new version), deletes through `deleteWorkspaceFileOperation` guarded the same way (Recently
 * Deleted keeps the file).
 * Only `context = 'workspace'` files are read; a file over the blob cap, or one whose path no
 * directory can hold, is left out of a get and never touched by an apply (a declaration of one is
 * refused, unless it is unchanged since a get that read the file). A path is the key, so a
 * file moved or deleted in the Files tab is recognized by the id its base entry names and never
 * created again at the old path.
 */
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { generateId } from '@sim/utils/id'
import { type BaseResource, resourceAddress } from '@sim/workspace-code'
import {
  type FileDecl,
  fileBlobPath,
  fileCodec,
  fileFingerprint,
  fileKeyConflicts,
  filePathProblem,
} from '@sim/workspace-code/kinds/files'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { resolveEffectiveMimeType } from '@/lib/uploads/utils/file'
import { encodeVfsPathSegments, normalizeDisplaySegment } from '@/lib/vfs/path'
import { parseTestFileReference } from '@/lib/workflow-tests/paths'
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
import { admitOnce } from '@/lib/workspace-source/application/context'
import { ResourceChangedError } from '@/lib/workspace-source/application/errors'
import {
  kindFinding,
  planUndeclared,
  serverChangedFinding,
  serverGoneFinding,
} from '@/lib/workspace-source/application/findings'
import {
  HASH_CONCURRENCY,
  spendHash,
  takeHashBudget,
} from '@/lib/workspace-source/application/hash-budget'
import { resolveDeclared, settle } from '@/lib/workspace-source/application/three-way'
import type {
  AppliedResource,
  ApplyContext,
  KindAdapter,
  PlanContext,
  PlannedChange,
  ReadOutcome,
  SourceContext,
  StoredResource,
  StoredSet,
} from '@/lib/workspace-source/application/types'
import {
  claimResourceKey,
  nextFreeKey,
  resolveIds,
  resourceKeyBase,
} from '@/lib/workspaces/resource-keys'

const logger = createLogger('WorkspaceSourceFiles')

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

/**
 * What a write carries out: for an update or delete, the content revision the plan saw (the
 * write refuses a file that moved past it); for a create, the resource key it claims.
 */
export interface FilePlan {
  rev?: string
  /**
   * The key a workflow names the created file by (`file('report-pdf')`), as a get would first
   * allocate it from the file's name: the create claims it, so a workflow this apply writes
   * after it resolves the file, as the dry run did through the create's pending entry.
   */
  resourceKey?: string
}

type FileChange = PlannedChange<'file'>

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

/**
 * A file's base entry: its id and fingerprint, plus the revision and hash it was read at under its
 * blob path, so a later plan knows the server's bytes are unchanged even without a stored hash.
 */
function fileBase(key: string, id: string, rev: string, sha256: string): BaseResource {
  return {
    id,
    fingerprint: fileFingerprint(sha256),
    blobs: { [fileBlobPath(key)]: { id, rev, sha256 } },
  }
}

/** The revision the base recorded for a file. */
function baseRev(key: string, base?: BaseResource): string | undefined {
  return base?.blobs?.[fileBlobPath(key)]?.rev
}

/** The hash the server holds: its own, or the base's when the revision has not moved since. */
function serverSha(file: StoredFile, base?: BaseResource): string | null {
  if (file.state.sha256 !== null) return file.state.sha256
  const recorded = base?.blobs?.[fileBlobPath(file.key)]
  return recorded && recorded.id === file.id && recorded.rev === file.state.rev
    ? recorded.sha256
    : null
}

/**
 * The fingerprint the server holds for a file: of its hash (its own, or the base's), or of its
 * revision when no hash is known, which matches nothing a directory declares.
 */
function storedFingerprint(file: StoredFile, base?: BaseResource): string {
  const sha = serverSha(file, base)
  return sha === null ? `unknown:${file.state.rev}` : fileFingerprint(sha)
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

/**
 * Hashes the stored bytes of each declared file whose hash neither the server nor the base
 * records, when its size matches the declared one (only then can the bytes be equal), within the
 * request's hashing budget (spent in declaration order, then downloaded a few at a time). Knowing
 * the hash lets an apply whose earlier run wrote the file without saving the base record it as a
 * no-op instead of refusing it. A file past the budget, or whose bytes cannot be read, keeps no
 * hash, so it plans as no-base or stale and the rest still apply.
 */
async function hashUnrecorded(
  ctx: PlanContext,
  desired: ReadonlyMap<string, FileDecl>,
  stored: StoredSet<StoredFileState>
): Promise<void> {
  const unrecorded: StoredFile[] = []
  for (const [key, decl] of desired) {
    const file = stored.bound.get(key)
    if (!file || file.state.unmanaged || file.state.size !== decl.size) continue
    if (serverSha(file, ctx.base?.resources[resourceAddress('file', key)]) !== null) continue
    unrecorded.push(file)
  }
  const { taken } = takeHashBudget(ctx, unrecorded, (file) => file.state.size)
  await mapWithConcurrency(taken, HASH_CONCURRENCY, async (file) => {
    try {
      file.state.sha256 = sha256Hex(await storedBytes(ctx, file.id))
    } catch (error) {
      logger.warn('Could not read a stored file to hash it', { fileId: file.id, error })
    }
  })
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

/**
 * Rethrows a write's `conflict` (the file's content moved past the revision the plan saw) as the
 * change being stale, and any other error as it is.
 */
function staleAs(change: PlannedChange) {
  return (error: unknown): never => {
    if (error instanceof OrchestrationError && error.code === 'conflict') {
      throw new ResourceChangedError(change)
    }
    throw error
  }
}

/** Why a directory never writes a file at a workflow test's path. */
const WORKFLOW_TEST_REASON = 'is where a workflow test lives, which is not a plain workspace file'

/**
 * Whether `key` is a workflow test's path (`tests/<name>.test.js`): workflow tests are files of
 * their own, so source never creates, changes or deletes a plain file there.
 */
function isWorkflowTestPath(key: string): boolean {
  return parseTestFileReference(key) !== null
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
  const stale = base.fingerprint !== fileFingerprint(decl.sha256)
  change.diagnostics.push(
    serverGoneFinding('file', change.key, stale, moved ? fileBlobPath(moved.key) : undefined)
  )
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
    // A file a get read that the server can no longer hand to source (edited past the cap, or a
    // file moved in that takes its path by letter case): an unchanged declaration leaves it be.
    if (base?.id === existing.id && base.fingerprint === fileFingerprint(decl.sha256)) {
      change.diagnostics.push(serverChangedFinding('file', key))
      return { ...change, storedId: existing.id }
    }
    change.diagnostics.push(
      kindFinding(
        'file',
        key,
        existing.state.unmanaged.code,
        `${fileBlobPath(key)} on the server is never written by source: ${existing.state.unmanaged.reason}.`,
        { hint: 'Remove it from files/ and change it in the Files tab.', file: fileBlobPath(key) }
      )
    )
    return { ...change, storedId: existing.id }
  }
  const resolution = resolveDeclared({
    local: fileFingerprint(decl.sha256),
    stored: existing,
    base,
    fingerprint: storedFingerprint,
    holds: (id) => byId.has(id),
  })
  const planned = settle(resolution, change, (file) =>
    fileBase(key, file.id, file.state.rev, decl.sha256)
  )
  if ('settled' in planned) return planned.settled
  if (planned.action === 'update') {
    return {
      ...change,
      action: 'update',
      storedId: planned.stored.id,
      fields: [`bytes (${planned.stored.state.size} → ${decl.size})`],
      needsBlobs: [fileBlobPath(key)],
      detail: { rev: planned.stored.state.rev },
    }
  }
  // A file is never adopted (nothing is offered for adoption), so this is a create.
  if (isWorkflowTestPath(key)) {
    change.diagnostics.push(
      kindFinding('file', key, 'E_FILE_PATH', `${fileBlobPath(key)} ${WORKFLOW_TEST_REASON}.`, {
        hint: 'Workflow tests are managed apart from files/; move this file to another folder.',
        file: fileBlobPath(key),
      })
    )
    return change
  }
  const renamed = renamedSegment(key)
  if (renamed !== null) {
    change.diagnostics.push(
      kindFinding(
        'file',
        key,
        'E_FILE_NAME',
        `${fileBlobPath(key)} cannot be created under this name: ${renamed}.`,
        {
          hint: 'Rename it locally to the name the server would store.',
          file: fileBlobPath(key),
        }
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

/**
 * Files the server holds that the directory no longer declares: only one the base records is
 * deleted, only with `--allow-delete`, and only while its bytes are the ones the base recorded at
 * the revision it recorded (a file rewritten since, even with the same bytes, is stale).
 */
function planDeletes(
  desired: ReadonlyMap<string, FileDecl>,
  stored: StoredSet<StoredFileState>,
  ctx: PlanContext,
  declared: readonly FileChange[]
): FileChange[] {
  const managed: StoredSet<StoredFileState> = {
    bound: new Map([...stored.bound].filter(([, file]) => !file.state.unmanaged)),
    unbound: [],
  }
  return planUndeclared('file', desired, managed, ctx, {
    declared,
    fingerprint: (file, base) =>
      baseRev(file.key, base) === file.state.rev
        ? storedFingerprint(file, base)
        : `rev:${file.state.rev}`,
    counts: (file) => ({ bytes: file.state.size }),
    detail: (file) => ({ rev: file.state.rev }),
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
    creates.get(key)?.diagnostics.push(
      kindFinding('file', key, 'E_FILE_PATH_COLLISION', `${conflict} on the server.`, {
        hint: 'Use the server’s spelling, or delete the server’s file in this apply (--allow-delete).',
        file: fileBlobPath(key),
      })
    )
  }
}

/** Keys past those a plan's creates of one key base take, checked for files holding them live. */
const KEY_CANDIDATES = 8

/**
 * Gives each create (one without findings) the resource key a get would first allocate it, so a
 * workflow of the same apply can name the file: a pending entry under that key, and the key the
 * create claims once written. A key a live file holds already is skipped, as allocation skips it.
 */
async function keyCreates(ctx: PlanContext, files: FileChange[]): Promise<void> {
  const creates = files.filter(
    (change) => change.action === 'create' && change.diagnostics.length === 0
  )
  if (creates.length === 0) return
  const bases = creates.map((change) =>
    resourceKeyBase('file', change.key.slice(change.key.lastIndexOf('/') + 1))
  )
  const sharing = new Map<string, number>()
  for (const base of bases) sharing.set(base, (sharing.get(base) ?? 0) + 1)
  // Every key the creates of a base could take: one each, plus as many as live files may hold.
  const candidates = [...sharing].flatMap(([base, creates]) => {
    const keys = new Set<string>()
    while (keys.size < creates + KEY_CANDIDATES) keys.add(nextFreeKey(base, keys))
    return [...keys]
  })
  const live = (
    await resolveIds(
      ctx.workspace.workspaceId,
      candidates.map((key) => ({ kind: 'file' as const, key }))
    )
  ).get('file')
  const taken = new Set(live?.keys() ?? [])
  creates.forEach((change, index) => {
    const resourceKey = nextFreeKey(bases[index], taken)
    taken.add(resourceKey)
    const name = change.key.slice(change.key.lastIndexOf('/') + 1)
    change.detail = { resourceKey }
    change.pending = { kind: 'file', key: resourceKey, id: generateId(), placeholder: true, name }
  })
}

/**
 * Binds `resourceKey` to a file this apply creates, inside the create's transaction `tx`, so a
 * claim that fails undoes the create rather than leaving a file no later apply keys. A key another
 * live file took since the plan refuses the create (`E_NAME_TAKEN`); applying again picks a free
 * key.
 */
async function claimFileKey(
  ctx: SourceContext,
  resourceKey: string,
  fileId: string,
  tx: DbTransaction
): Promise<void> {
  await claimResourceKey({
    workspaceId: ctx.workspace.workspaceId,
    kind: 'file',
    key: resourceKey,
    resourceId: fileId,
    origin: 'created',
    createdBy: ctx.createdBy,
    tx,
  })
}

/**
 * The bytes a write sends and their SHA-256: read from the staging area, which checks them
 * against the declared hash, so the declaration's hash is theirs. `stored` reports them stored
 * once the write lands, so their staged copy stops counting toward the quota.
 */
async function contentOf(
  change: FileChange,
  ctx: ApplyContext
): Promise<{ content: Buffer; sha256: string; stored: () => void }> {
  const { blobs } = ctx
  if (!change.decl || !blobs) throw new Error('A file write needs its declaration and bytes')
  const path = fileBlobPath(change.key)
  return {
    content: await blobs.read(path),
    sha256: change.decl.sha256,
    stored: () => blobs.stored(path),
  }
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

export const fileAdapter: KindAdapter<'file', StoredFileState> = {
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
            : isWorkflowTestPath(key)
              ? { code: 'E_FILE_PATH', reason: `its path ${WORKFLOW_TEST_REASON}` }
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
    const deletes = planDeletes(desired, stored, ctx, files)
    refuseCollisions(files, stored, deletes)
    await keyCreates(ctx, files)
    return [...files, ...deletes]
  },

  async authorize(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    if (change.action === 'create') {
      await admitOnce(ctx, 'file:create', () => admitCreateWorkspaceFile(principal, workspaceId))
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
      const rev = change.detail?.rev
      if (!fileId || rev === undefined) throw new Error('A file delete needs its plan')
      await deleteWorkspaceFileOperation
        .execute({
          principal,
          input: { fileId, assertedWorkspaceId: workspaceId, expectedRevision: rev },
        })
        .catch(staleAs(change))
      return { id: fileId, text: {} }
    }
    const { content, sha256, stored } = await contentOf(change, ctx)
    if (change.action === 'create') {
      const segments = change.key.split('/')
      const resourceKey = change.detail?.resourceKey
      const created = await createWorkspaceFileBufferByPath.execute({
        principal,
        input: {
          workspaceId,
          path: fileBlobPath(encodeVfsPathSegments(segments)),
          content,
          contentType: resolveEffectiveMimeType(undefined, segments[segments.length - 1] ?? ''),
          mode: 'create',
          exactName: true,
          ...(resourceKey
            ? { withinCreate: (tx, fileId) => claimFileKey(ctx, resourceKey, fileId, tx) }
            : {}),
        },
      })
      stored()
      return written(ctx, change.key, created.id, sha256)
    }
    const fileId = change.storedId
    const rev = change.detail?.rev
    if (!fileId || rev === undefined) throw new Error('A file update needs its plan')
    await updateWorkspaceFileContentFromBuffer
      .execute({
        principal,
        input: {
          fileId,
          assertedWorkspaceId: workspaceId,
          content,
          provenanceMode: 'replace_empty',
          expectedRevision: rev,
        },
      })
      .catch(staleAs(change))
    stored()
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
    if (sha256 === null && spendHash(ctx, size)) {
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

  /**
   * Reads every file, first hashing those whose hash nothing records (older files), within the
   * request's budget and a few at a time, so a get never downloads them one after another. A file
   * whose bytes cannot be read is that file's error.
   */
  async readMany(stored, ctx) {
    const outcomes = new Map<string, ReadOutcome>()
    const unrecorded = stored.filter((file) => !file.state.unmanaged && file.state.sha256 === null)
    const { taken } = takeHashBudget(ctx, unrecorded, (file) => file.state.size)
    await mapWithConcurrency(taken, HASH_CONCURRENCY, async (file) => {
      try {
        const content = await storedBytes(ctx, file.id)
        file.state.sha256 = sha256Hex(content)
        file.state.size = content.length
      } catch (error) {
        outcomes.set(file.key, { error })
      }
    })
    for (const file of stored) {
      if (outcomes.has(file.key)) continue
      try {
        outcomes.set(file.key, { read: await this.read(file, ctx) })
      } catch (error) {
        outcomes.set(file.key, { error })
      }
    }
    return outcomes
  },
}
