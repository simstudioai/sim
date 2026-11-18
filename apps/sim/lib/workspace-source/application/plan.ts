/**
 * Plans a workspace source apply without writing: read the base, parse every managed kind's
 * files, load what is stored, let each kind plan its resources (in apply order, so a later kind's
 * dry run resolves keys an earlier kind creates), check references across kinds, authorize every
 * change through the use case that will make it, and cap the plan's size. Any error in the result
 * refuses the whole apply before anything is written.
 */
import { sha256Hex } from '@sim/security/hash'
import { utf8Bytes } from '@sim/workflow-code/limits'
import {
  APPLY_ORDER,
  type BlobEntry,
  emptyBase,
  flattenDiagnostic,
  isFileKind,
  KIND_DIRS,
  parseWorkspaceBase,
  resourceAddress,
  type WorkspaceBaseV1,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { isBlobPath, KIND_LAYOUTS } from '@sim/workspace-code/kinds/registry'
import { kindOfPath, WORKSPACE_BASE_FILE } from '@sim/workspace-code/layout'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
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
import { KIND_ADAPTERS } from '@/lib/workspace-source/application/registry'
import type {
  PlanContext,
  PlannedChange,
  SourceContext,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'

/** What a workspace source submission carries, whether it is applied or dry-run. */
export interface WorkspaceSourceSubmission {
  /** Workspace-relative path → text, for every managed kind's text files. */
  files: Record<string, string>
  /** Binary files by hash, with their base64 content when this round carries it. */
  blobs?: Array<BlobEntry & { content?: string }>
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
  /** Blob paths a change writes whose content this round did not carry. */
  needBlobs: string[]
  /** The bytes this round carries by path, checked against their hash and size. */
  carried: ReadonlyMap<string, Buffer>
  /**
   * Whether an error refuses the whole apply: any error but those of changes held back (see
   * `PlannedChange.held`), which only keep those changes from being written.
   */
  refused: boolean
  /**
   * The root files of the managed file kinds (`secrets.ts`), printed from their declarations: an
   * apply writes them back so the directory holds them as a get would.
   */
  reprint: Record<string, string>
}

type SubmittedBlob = NonNullable<WorkspaceSourceSubmission['blobs']>[number]

/**
 * The blob manifest by path (hash and size only) and the paths whose content this round sent,
 * refusing a path listed twice or one that holds no binary file. With `decode`, the content each
 * blob carries is decoded once and checked against its declared hash and size, so bytes that
 * changed while they were sent refuse the apply before anything is written, and a round carrying
 * more than `maxBlobBytesPerRequest` is refused; a dry run never decodes.
 */
function readBlobs(
  blobs: readonly SubmittedBlob[],
  decode: boolean,
  diagnostics: WorkspaceSourceDiagnostic[]
): { byPath: Map<string, BlobEntry>; carried: Map<string, Buffer>; sent: Set<string> } {
  const byPath = new Map<string, BlobEntry>()
  const carried = new Map<string, Buffer>()
  const sent = new Set<string>()
  let carriedBytes = 0
  for (const blob of blobs) {
    const refuse = (message: string, hint?: string) =>
      diagnostics.push(
        finding('E_BLOB_CONTENT', message, { file: blob.path, ...(hint ? { hint } : {}) })
      )
    if (!isBlobPath(blob.path)) {
      refuse(`${blob.path} is sent as a binary file, but no binary file lives at that path.`)
      continue
    }
    if (byPath.has(blob.path)) {
      refuse(`${blob.path} is listed twice.`)
      continue
    }
    if (blob.content !== undefined) sent.add(blob.path)
    byPath.set(blob.path, { path: blob.path, sha256: blob.sha256, size: blob.size })
    if (!decode || blob.content === undefined) continue
    const bytes = Buffer.from(blob.content, 'base64')
    if (bytes.byteLength !== blob.size || sha256Hex(bytes) !== blob.sha256) {
      refuse(
        `${blob.path} does not match the SHA-256 and size the directory declared for it.`,
        'It changed while it was sent; apply again.'
      )
      continue
    }
    carried.set(blob.path, bytes)
    carriedBytes += bytes.byteLength
  }
  const { maxBlobBytesPerRequest } = WORKSPACE_SOURCE_LIMITS
  if (carriedBytes > maxBlobBytesPerRequest) {
    diagnostics.push(
      finding(
        'E_LIMIT_EXCEEDED',
        `This round carries ${carriedBytes} bytes of binary files, over the ${maxBlobBytesPerRequest}-byte limit.`,
        { hint: 'Send the rest of the files in the next round.' }
      )
    )
  }
  return { byPath, carried, sent }
}

/** Changes a plan authorizes at once. */
const AUTHORIZE_CONCURRENCY = 6

/** Findings one plan reports; past it, one more finding counts the rest. */
const MAX_PLAN_FINDINGS = 1_000

/** `diagnostics` within {@link MAX_PLAN_FINDINGS}, errors first so a refusal always shows why. */
function capFindings(diagnostics: WorkspaceSourceDiagnostic[]): WorkspaceSourceDiagnostic[] {
  if (diagnostics.length <= MAX_PLAN_FINDINGS) return diagnostics
  const errors = diagnostics.filter((entry) => entry.severity === 'error')
  const rest = diagnostics.filter((entry) => entry.severity !== 'error')
  const kept = [...errors, ...rest].slice(0, MAX_PLAN_FINDINGS)
  return [
    ...kept,
    finding(
      'E_LIMIT_EXCEEDED',
      `The plan has ${diagnostics.length} findings; ${diagnostics.length - kept.length} more are left out.`,
      { hint: 'Fix the findings shown, then apply again.' }
    ),
  ]
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
  const bytes = { declaration: 0, workflow: 0 }
  for (const [path, text] of Object.entries(files)) {
    const kind = kindOfPath(path)
    if (kind) bytes[KIND_LAYOUTS[kind].budget ?? 'declaration'] += utf8Bytes(text)
  }
  const { maxDeclarationBytes, maxWorkflowBytes } = WORKSPACE_SOURCE_LIMITS
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
 * Plans `submission`. With `decodeBlobs` (an apply that writes), the content the round carries is
 * decoded and checked into `carried`; a dry run leaves it encoded and unread.
 */
export async function planWorkspaceSource(
  submission: WorkspaceSourceSubmission,
  ctx: SourceContext,
  options: { decodeBlobs?: boolean } = {}
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
  const blobs = readBlobs(submission.blobs ?? [], options.decodeBlobs === true, diagnostics)
  if (diagnostics.some((finding) => finding.severity === 'error')) {
    return {
      changes: [],
      diagnostics: capFindings(diagnostics),
      base,
      needBlobs: [],
      carried: blobs.carried,
      refused: true,
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
    const adapter = KIND_ADAPTERS[kind]
    const paths = [...Object.keys(files), ...blobs.byPath.keys()].filter(
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
    const desired = new Map<string, unknown>()
    for (const [key, group] of grouped.groups) {
      const text = Object.fromEntries(
        group.filter((path) => Object.hasOwn(files, path)).map((path) => [path, files[path]])
      )
      const parsed = adapter.codec.parse(
        key,
        text,
        group.flatMap((path) => blobs.byPath.get(path) ?? [])
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

  await warnDeployedDraftChanges(changes, ctx)
  await checkDeletesInUse(changes, unchanged, workspaceId)
  for (const kind of APPLY_ORDER) {
    try {
      await KIND_ADAPTERS[kind].checkRefs?.(changes, planCtx)
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
  holdUnavailable(changes)

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
        await KIND_ADAPTERS[change.kind].authorize(change, ctx)
      } catch (caught) {
        change.diagnostics.push(refusalDiagnostic(caught, { kind: change.kind, key: change.key }))
      }
    })
  }
  // Errors outside the changes, then those of changes not held back, refuse the apply.
  const refused =
    diagnostics.some((finding) => finding.severity === 'error') ||
    changes.some(
      (change) => !change.held && change.diagnostics.some((finding) => finding.severity === 'error')
    )
  for (const change of changes) diagnostics.push(...change.diagnostics)

  const needBlobs = [
    ...new Set(
      writes.flatMap((change) => change.needsBlobs ?? []).filter((path) => !blobs.sent.has(path))
    ),
  ]
  return {
    changes,
    diagnostics: capFindings(diagnostics),
    base,
    needBlobs,
    carried: blobs.carried,
    refused,
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
  const writes = changes.filter((change) => change.action !== 'noop' && change.action !== 'delete')
  const held = new Set<string>()
  for (const change of writes) {
    for (const ref of change.refs ?? []) {
      const reference = unavailable.get(resourceAddress(ref.kind, ref.key))
      if (!reference) continue
      change.diagnostics.push(refUnavailableFinding(change, reference))
      change.held = true
      // An unbindable credential key dry-runs under a placeholder id, which the workflow's
      // credential gate refuses as unreachable: the hold says why, so that refusal is dropped.
      if (ref.kind === 'credential') {
        change.diagnostics = change.diagnostics.filter(
          (finding) => finding.code !== 'E_APPLY_CREDENTIAL_UNREACHABLE'
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
