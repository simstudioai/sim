/**
 * Plans a workspace source apply without writing: read the base, parse every managed kind's
 * files, load what is stored, let each kind plan its resources (in apply order, so a later kind's
 * dry run resolves keys an earlier kind creates), check references across kinds, authorize every
 * change through the use case that will make it, and cap the plan's size. Any error in the result
 * refuses the whole apply before anything is written.
 */

import { mapWithConcurrency } from '@sim/utils/concurrency'
import { utf8ByteLength } from '@sim/utils/paste'
import {
  APPLY_ORDER,
  type BlobEntry,
  budgetOfPath,
  emptyBase,
  flattenDiagnostic,
  isFileKind,
  KIND_DIRS,
  parseWorkspaceBase,
  resourceAddress,
  type SourceBudget,
  type WorkspaceBaseV1,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { isBlobPath, KIND_LAYOUTS } from '@sim/workspace-code/kinds/registry'
import { kindOfPath, WORKSPACE_BASE_FILE } from '@sim/workspace-code/layout'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { refusalDiagnostic } from '@/lib/workspace-source/application/errors'
import {
  finding,
  kindLimitFinding,
  overKindLimit,
  refDeletedFinding,
  refHeldFinding,
  refUnavailableFinding,
} from '@/lib/workspace-source/application/findings'
import { checkDeletesInUse } from '@/lib/workspace-source/application/in-use'
import { warnDeployedDraftChanges } from '@/lib/workspace-source/application/kinds/deployment/adapter'
import { refuseDeletingEveryWorkflow } from '@/lib/workspace-source/application/kinds/workflow/adapter'
import { adapterOf } from '@/lib/workspace-source/application/registry'
import { stagingScopeOf } from '@/lib/workspace-source/application/stage-blobs'
import type {
  DeclOf,
  PlanContext,
  PlannedChange,
  SourceContext,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'
import { findStagedBlobs, type StagedBlob } from '@/lib/workspace-source/staging/store'

/** What a workspace source submission carries, whether it is applied or dry-run. */
export interface WorkspaceSourceSubmission {
  /** Workspace-relative path → text, for every managed kind's text files. */
  files: Record<string, string>
  /** Binary files by path, with the SHA-256 and size of the bytes staged for them. */
  blobs?: BlobEntry[]
  /** `.sim/base.json` as the directory holds it, when it holds one. */
  base?: unknown
  /** The kind folders the directory holds, empty ones included: the kinds it manages. */
  kinds: WorkspaceKind[]
  /** Restricts the apply to these kinds. */
  only?: WorkspaceKind[]
  /** Deletes resources, columns and data the directory no longer declares. */
  allowDelete?: boolean
}

export interface WorkspacePlan {
  changes: PlannedChange[]
  diagnostics: WorkspaceSourceDiagnostic[]
  /** The base the apply starts from: the directory's, or an empty one for this workspace. */
  base: WorkspaceBaseV1
  /** Blob paths a change writes whose bytes the caller has not staged. */
  needBlobs: string[]
  /** The staged blob each written blob path reads its bytes from. */
  staged: ReadonlyMap<string, StagedBlob>
  /**
   * The errors that refuse the whole apply, empty when none does: every error but those of
   * changes held back (see `PlannedChange.held`), which only keep those changes from being
   * written. A refusal is classed by these alone.
   */
  refusing: WorkspaceSourceDiagnostic[]
  /**
   * The root files of the managed file kinds (`secrets.ts`), printed from their declarations: an
   * apply writes them back so the directory holds them as a get would.
   */
  reprint: Record<string, string>
}

/**
 * The blob manifest by path (hash and size), refusing a path listed twice or one that holds no
 * binary file. The bytes are staged beforehand and looked up by hash once the plan knows which
 * blobs its writes need.
 */
function readBlobs(
  blobs: readonly BlobEntry[],
  diagnostics: WorkspaceSourceDiagnostic[]
): Map<string, BlobEntry> {
  const byPath = new Map<string, BlobEntry>()
  for (const blob of blobs) {
    const refuse = (message: string) =>
      diagnostics.push(finding('E_BLOB_MANIFEST', message, { file: blob.path }))
    if (!isBlobPath(blob.path)) {
      refuse(`${blob.path} is sent as a binary file, but no binary file lives at that path.`)
      continue
    }
    if (byPath.has(blob.path)) {
      refuse(`${blob.path} is listed twice.`)
      continue
    }
    byPath.set(blob.path, { path: blob.path, sha256: blob.sha256, size: blob.size })
  }
  return byPath
}

/**
 * The staged blob behind each path a write needs, and the paths with none (never staged, expired,
 * or staged at another size). With `require`, each missing path is an `E_BLOB_MISSING` error, so
 * the apply is refused before its first write.
 */
async function resolveStaged(
  needed: readonly string[],
  manifest: ReadonlyMap<string, BlobEntry>,
  ctx: SourceContext,
  require: boolean,
  diagnostics: WorkspaceSourceDiagnostic[]
): Promise<{ staged: Map<string, StagedBlob>; missing: string[] }> {
  const entries = needed.flatMap((path) => manifest.get(path) ?? [])
  const found = await findStagedBlobs(
    stagingScopeOf(ctx.principal, ctx.workspace.workspaceId),
    entries.map((entry) => entry.sha256)
  )
  const staged = new Map<string, StagedBlob>()
  const missing: string[] = []
  for (const entry of entries) {
    const blob = found.get(entry.sha256)
    if (blob && blob.size === entry.size) staged.set(entry.path, blob)
    else missing.push(entry.path)
  }
  if (require) {
    for (const path of missing) {
      diagnostics.push(
        finding('E_BLOB_MISSING', `${path} is not staged, so nothing was written.`, {
          file: path,
          hint: 'Stage its bytes (POST /source/blobs; the CLI does this), then apply again.',
        })
      )
    }
  }
  return { staged, missing }
}

/** Changes a plan authorizes at once. */
const AUTHORIZE_CONCURRENCY = 6

/**
 * Names each reference made by id (`refs[].id`) by the key of the change that plans that resource
 * (its stored id, or the stand-in id of a create), so a delete of it and a write waiting for it
 * match the reference; one no change plans names nothing this apply touches and is dropped.
 */
function resolveRefsById(changes: PlannedChange[]): void {
  const byId = new Map<string, string>()
  for (const change of changes) {
    for (const id of [change.storedId, change.pending?.id]) {
      if (id) byId.set(`${change.kind}:${id}`, change.key)
    }
  }
  for (const change of changes) {
    if (!change.refs?.some((ref) => ref.id !== undefined)) continue
    change.refs = change.refs.flatMap((ref) => {
      if (ref.id === undefined) return [ref]
      const key = byId.get(`${ref.kind}:${ref.id}`)
      return key === undefined ? [] : [{ kind: ref.kind, key }]
    })
  }
}

/** The kinds the submission manages: its folders and files, narrowed by `only`. */
function managedKinds(submission: WorkspaceSourceSubmission): Set<WorkspaceKind> {
  const kinds = new Set(submission.kinds)
  for (const path of Object.keys(submission.files)) {
    const kind = kindOfPath(path)
    if (kind) kinds.add(kind)
  }
  if (submission.only)
    for (const kind of kinds) if (!submission.only.includes(kind)) kinds.delete(kind)
  return kinds
}

/** Reads the directory's base; one read in another workspace counts as none (deletes stay off). */
function readBase(
  submission: WorkspaceSourceSubmission,
  workspaceId: string,
  diagnostics: WorkspaceSourceDiagnostic[]
): WorkspaceBaseV1 | null {
  if (submission.base === undefined) return null
  const parsed = parseWorkspaceBase(submission.base)
  if (!parsed.base) {
    diagnostics.push(
      ...parsed.diagnostics.map((finding) => ({
        ...flattenDiagnostic(finding),
        file: WORKSPACE_BASE_FILE,
      }))
    )
    return null
  }
  if (parsed.base.workspaceId !== workspaceId) {
    diagnostics.push(
      finding(
        'W_BASE_OTHER_WORKSPACE',
        `${WORKSPACE_BASE_FILE} was read from workspace ${parsed.base.workspaceId}, so this apply treats every resource as new here and deletes nothing.`,
        {
          hint: `To apply to the workspace it was read from, pass --workspace ${parsed.base.workspaceId}.`,
          file: WORKSPACE_BASE_FILE,
        }
      )
    )
    return null
  }
  return parsed.base
}

/** Refuses a submission over the request-wide byte limits before anything is parsed. */
function checkLimits(
  files: Record<string, string>,
  diagnostics: WorkspaceSourceDiagnostic[]
): void {
  const bytes: Record<SourceBudget, number> = { declaration: 0, workflow: 0, rows: 0 }
  for (const [path, text] of Object.entries(files)) {
    const kind = kindOfPath(path)
    if (kind) bytes[budgetOfPath(KIND_LAYOUTS[kind], path)] += utf8ByteLength(text)
  }
  const { maxDeclarationBytes, maxRowsBytes, maxWorkflowBytes } = WORKSPACE_SOURCE_LIMITS
  if (bytes.rows > maxRowsBytes) {
    diagnostics.push(
      finding(
        'E_LIMIT_EXCEEDED',
        `The table rows files total ${bytes.rows} bytes, over the ${maxRowsBytes}-byte limit.`,
        { hint: 'Keep fewer rows in source; seed or manage the rest another way.' }
      )
    )
  }
  if (bytes.declaration > maxDeclarationBytes) {
    diagnostics.push(
      finding(
        'E_LIMIT_EXCEEDED',
        `The declarations total ${bytes.declaration} bytes, over the ${maxDeclarationBytes}-byte limit.`
      )
    )
  }
  if (bytes.workflow > maxWorkflowBytes) {
    diagnostics.push(
      finding(
        'E_LIMIT_EXCEEDED',
        `The workflow files total ${bytes.workflow} bytes, over the ${maxWorkflowBytes}-byte limit.`,
        { hint: 'Apply fewer edited workflows at once.' }
      )
    )
  }
}

/**
 * Plans `submission`. With `requireBlobs` (an apply that writes), a blob a write needs that is not
 * staged refuses the apply; a dry run lists such blobs in `needBlobs` instead.
 */
export async function buildWorkspacePlan(
  submission: WorkspaceSourceSubmission,
  ctx: SourceContext,
  options: { requireBlobs?: boolean } = {}
): Promise<WorkspacePlan> {
  const { workspaceId } = ctx.workspace
  const diagnostics: WorkspaceSourceDiagnostic[] = []
  const directoryBase = readBase(submission, workspaceId, diagnostics)
  const base = directoryBase ?? emptyBase(workspaceId)
  const managed = managedKinds(submission)
  const files = Object.fromEntries(
    Object.entries(submission.files).filter(([path]) => {
      const kind = kindOfPath(path)
      if (kind) return managed.has(kind)
      diagnostics.push(
        finding('E_DECL_UNKNOWN_FILE', `${path} is outside every kind's folder.`, { file: path })
      )
      return false
    })
  )
  checkLimits(files, diagnostics)
  const manifest = readBlobs(submission.blobs ?? [], diagnostics)
  if (diagnostics.some((finding) => finding.severity === 'error')) {
    return {
      changes: [],
      diagnostics,
      base,
      needBlobs: [],
      staged: new Map(),
      refusing: diagnostics.filter((finding) => finding.severity === 'error'),
      reprint: {},
    }
  }

  const changes: PlannedChange[] = []
  const planCtx: PlanContext = {
    ...ctx,
    base: directoryBase,
    allowDelete: submission.allowDelete === true,
    pending: [],
    planned: changes,
  }
  const reprint: Record<string, string> = {}
  // Declarations sent without their files, by kind: the codec reads them as unchanged.
  const unchanged = new Map<WorkspaceKind, ReadonlySet<string>>()
  for (const kind of APPLY_ORDER) {
    if (!managed.has(kind)) continue
    const adapter = adapterOf(kind)
    const paths = [...Object.keys(files), ...manifest.keys()].filter(
      (path) => kindOfPath(path) === kind
    )
    const grouped = adapter.codec.group(paths)
    const kindFindings = grouped.diagnostics.map(flattenDiagnostic)
    if (grouped.groups.size > WORKSPACE_SOURCE_LIMITS.maxResourcesPerKind) {
      kindFindings.push(
        finding(
          'E_LIMIT_EXCEEDED',
          `${KIND_DIRS[kind]}/ declares ${grouped.groups.size} resources, over the ${WORKSPACE_SOURCE_LIMITS.maxResourcesPerKind} limit.`,
          { kind }
        )
      )
    }
    const desired = new Map<string, DeclOf<WorkspaceKind>>()
    for (const [key, group] of grouped.groups) {
      const text = Object.fromEntries(
        group.filter((path) => Object.hasOwn(files, path)).map((path) => [path, files[path]])
      )
      const parsed = adapter.codec.parse(
        key,
        text,
        group.flatMap((path) => manifest.get(path) ?? [])
      )
      kindFindings.push(...parsed.diagnostics.map(flattenDiagnostic))
      if (parsed.decl === undefined) continue
      desired.set(key, parsed.decl)
      if (isFileKind(kind)) Object.assign(reprint, adapter.codec.print(key, parsed.decl).text)
    }
    const unchangedKeys = new Set(
      [...desired].filter(([, decl]) => adapter.codec.isUnchanged?.(decl)).map(([key]) => key)
    )
    unchanged.set(kind, unchangedKeys)
    const sent = desired.size - unchangedKeys.size
    if (adapter.codec.budget === 'workflow' && sent > WORKSPACE_SOURCE_LIMITS.maxWorkflows) {
      kindFindings.push(
        finding(
          'E_PLAN_TOO_LARGE',
          `The apply sends ${sent} workflows, over the ${WORKSPACE_SOURCE_LIMITS.maxWorkflows}-workflow limit.`,
          { hint: 'Apply fewer edited workflows at once.' }
        )
      )
    }
    diagnostics.push(...kindFindings)
    // A resource that failed to parse would read as undeclared, so a broken kind is not planned.
    if (kindFindings.some((finding) => finding.severity === 'error')) continue
    try {
      const stored = await adapter.load(ctx, { allocate: false })
      if (overKindLimit(stored)) {
        diagnostics.push(kindLimitFinding(kind))
        continue
      }
      const planned = await adapter.plan(desired, stored, planCtx)
      changes.push(...planned)
      planCtx.pending.push(...planned.flatMap((change) => change.pending ?? []))
    } catch (caught) {
      diagnostics.push(refusalDiagnostic(caught, { kind }))
    }
  }

  resolveRefsById(changes)
  // Holds first: a held workflow keeps its stored references and creates nothing, which the
  // delete checks then read.
  holdUnavailable(changes)
  await refuseDeletingEveryWorkflow(changes, workspaceId)
  await warnDeployedDraftChanges(changes, ctx)
  await checkDeletesInUse(changes, unchanged, workspaceId)
  for (const kind of APPLY_ORDER) {
    try {
      await adapterOf(kind).checkRefs?.(changes, planCtx)
    } catch (caught) {
      diagnostics.push(refusalDiagnostic(caught, { kind }))
    }
  }
  const deleted = new Set(
    changes
      .filter((change) => change.action === 'delete')
      .map((change) => resourceAddress(change.kind, change.key))
  )
  for (const change of changes) {
    for (const ref of change.refs ?? []) {
      if (!deleted.has(resourceAddress(ref.kind, ref.key))) continue
      diagnostics.push(refDeletedFinding(change, ref))
    }
  }

  const writes = changes.filter((change) => change.action !== 'noop')
  if (writes.length > WORKSPACE_SOURCE_LIMITS.maxChanges) {
    diagnostics.push(
      finding(
        'E_PLAN_TOO_LARGE',
        `The apply makes ${writes.length} changes, over the ${WORKSPACE_SOURCE_LIMITS.maxChanges}-change limit.`
      )
    )
  }
  // A plan already refused authorizes nothing more (that could be every change of every kind).
  if (!diagnostics.some((finding) => finding.severity === 'error')) {
    const authorizable = writes.filter(
      (change) => !change.diagnostics.some((finding) => finding.severity === 'error')
    )
    await mapWithConcurrency(authorizable, AUTHORIZE_CONCURRENCY, async (change) => {
      try {
        await adapterOf(change.kind).authorize(change, ctx)
      } catch (caught) {
        change.diagnostics.push(refusalDiagnostic(caught, { kind: change.kind, key: change.key }))
      }
    })
  }
  // Errors outside the changes, then those of changes not held back, refuse the apply.
  const refusedByPlan =
    diagnostics.some((finding) => finding.severity === 'error') ||
    changes.some(
      (change) => !change.held && change.diagnostics.some((finding) => finding.severity === 'error')
    )
  const needed = [
    ...new Set(
      writes.filter((change) => !change.held).flatMap((change) => change.needsBlobs ?? [])
    ),
  ]
  // A missing blob refuses only a plan nothing else refuses: the fix comes first, the upload after.
  const blobs = await resolveStaged(
    needed,
    manifest,
    ctx,
    options.requireBlobs === true && !refusedByPlan,
    diagnostics
  )
  const isError = (finding: WorkspaceSourceDiagnostic) => finding.severity === 'error'
  const refusing = [
    ...diagnostics.filter(isError),
    ...changes.flatMap((change) => (change.held ? [] : change.diagnostics.filter(isError))),
  ]
  for (const change of changes) diagnostics.push(...change.diagnostics)

  return {
    changes,
    diagnostics,
    base,
    needBlobs: blobs.missing,
    staged: blobs.staged,
    refusing,
    reprint,
  }
}

/**
 * Holds back every write that uses an unavailable reference (a declared secret the workspace has
 * no value for, a declared credential key nothing binds to), and then every write that uses a
 * resource held back (a workflow another held workflow creates), each with the finding that says
 * why. A held change is not written; the rest of the apply goes ahead.
 */
function holdUnavailable(changes: PlannedChange[]): void {
  const unavailable = new Map(
    changes.flatMap((change) =>
      change.unavailable ? [[resourceAddress(change.kind, change.key), change.unavailable]] : []
    )
  )
  if (unavailable.size === 0) return
  // An unbindable credential key dry-runs under a placeholder id, which the workflow's credential
  // gate refuses as unreachable, naming the id: the hold says why, so that refusal is dropped. A
  // refusal of another key's credential stays.
  const placeholders = new Map(
    changes.flatMap((change) =>
      change.kind === 'credential' && change.unavailable && change.pending?.placeholder
        ? [[change.key, change.pending.id]]
        : []
    )
  )
  const writes = changes.filter((change) => change.action !== 'noop' && change.action !== 'delete')
  const held = new Set<string>()
  for (const change of writes) {
    for (const ref of change.refs ?? []) {
      const reference = unavailable.get(resourceAddress(ref.kind, ref.key))
      if (!reference) continue
      change.diagnostics.push(refUnavailableFinding(change, reference))
      change.held = true
      const placeholder = ref.kind === 'credential' ? placeholders.get(ref.key) : undefined
      if (placeholder !== undefined) {
        change.diagnostics = change.diagnostics.filter(
          (finding) =>
            finding.code !== 'E_APPLY_CREDENTIAL_UNREACHABLE' ||
            !finding.message.includes(`"${placeholder}"`)
        )
      }
    }
    if (change.held) held.add(resourceAddress(change.kind, change.key))
  }
  for (let grew = held.size > 0; grew; ) {
    grew = false
    for (const change of writes) {
      if (change.held) continue
      const ref = (change.refs ?? []).find((each) => held.has(resourceAddress(each.kind, each.key)))
      if (!ref) continue
      change.diagnostics.push(refHeldFinding(change, ref))
      change.held = true
      held.add(resourceAddress(change.kind, change.key))
      grew = true
    }
  }
}
