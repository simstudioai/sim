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
  KIND_DIRS,
  parseWorkspaceBase,
  resourceAddress,
  type WorkspaceBaseV1,
  type WorkspaceDiagnosticCode,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { isBlobPath, kindOfPath, WORKSPACE_BASE_FILE } from '@sim/workspace-code/layout'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { refusalDiagnostic } from '@/lib/workspace-source/application/errors'
import { finding } from '@/lib/workspace-source/application/findings'
import { checkDeletesInUse } from '@/lib/workspace-source/application/in-use'
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
}

type SubmittedBlob = NonNullable<WorkspaceSourceSubmission['blobs']>[number]

/**
 * The blob manifest by path, refusing a path listed twice or one that holds no binary file. With
 * `decode`, the content each blob carries is decoded once and checked against its declared hash
 * and size, so bytes that changed while they were sent refuse the apply before anything is
 * written; a dry run never decodes.
 */
function readBlobs(
  blobs: readonly SubmittedBlob[],
  decode: boolean,
  diagnostics: WorkspaceSourceDiagnostic[]
): { byPath: Map<string, SubmittedBlob>; carried: Map<string, Buffer> } {
  const byPath = new Map<string, SubmittedBlob>()
  const carried = new Map<string, Buffer>()
  for (const blob of blobs) {
    const refuse = (message: string, hint?: string) =>
      diagnostics.push(
        error('E_BLOB_CONTENT', message, { file: blob.path, ...(hint ? { hint } : {}) })
      )
    if (!isBlobPath(blob.path)) {
      refuse(`${blob.path} is sent as a binary file, but no binary file lives at that path.`)
      continue
    }
    if (byPath.has(blob.path)) {
      refuse(`${blob.path} is listed twice.`)
      continue
    }
    byPath.set(blob.path, blob)
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
  }
  return { byPath, carried }
}

function error(
  code: WorkspaceDiagnosticCode & `E_${string}`,
  message: string,
  extra: Partial<WorkspaceSourceDiagnostic> = {}
) {
  return finding(code, message, extra)
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

/** Refuses a submission over the request-wide limits before anything is parsed. */
function checkLimits(
  files: Record<string, string>,
  diagnostics: WorkspaceSourceDiagnostic[]
): void {
  let declarationBytes = 0
  let workflowBytes = 0
  const workflows = new Set<string>()
  for (const [path, text] of Object.entries(files)) {
    const kind = kindOfPath(path)
    if (!kind) continue
    if (kind === 'workflow') {
      workflowBytes += utf8Bytes(text)
      workflows.add(path.split('/')[1] ?? '')
    } else declarationBytes += utf8Bytes(text)
  }
  const { maxDeclarationBytes, maxWorkflowBytes, maxWorkflows } = WORKSPACE_SOURCE_LIMITS
  if (declarationBytes > maxDeclarationBytes) {
    diagnostics.push(
      error(
        'E_LIMIT_EXCEEDED',
        `The declarations total ${declarationBytes} bytes, over the ${maxDeclarationBytes}-byte limit.`
      )
    )
  }
  if (workflowBytes > maxWorkflowBytes) {
    diagnostics.push(
      error(
        'E_LIMIT_EXCEEDED',
        `The workflow files total ${workflowBytes} bytes, over the ${maxWorkflowBytes}-byte limit.`,
        {
          hint: 'Apply fewer edited workflows at once.',
        }
      )
    )
  }
  if (workflows.size > maxWorkflows) {
    diagnostics.push(
      error(
        'E_PLAN_TOO_LARGE',
        `The apply sends ${workflows.size} workflows, over the ${maxWorkflows}-workflow limit.`,
        {
          hint: 'Apply fewer edited workflows at once.',
        }
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
        error('E_DECL_UNKNOWN_FILE', `${path} is outside every kind's folder.`, { file: path })
      )
      return false
    })
  )
  checkLimits(files, diagnostics)
  const blobs = readBlobs(submission.blobs ?? [], options.decodeBlobs === true, diagnostics)
  if (diagnostics.some((finding) => finding.severity === 'error')) {
    return { changes: [], diagnostics, base, needBlobs: [], carried: blobs.carried }
  }

  const planCtx: PlanContext = {
    ...ctx,
    base: directoryBase,
    allowDelete: submission.allowDelete === true,
    pending: [],
  }
  const changes: PlannedChange[] = []
  let declaredWorkflows: ReadonlyMap<string, unknown> = new Map()
  const references: Array<{
    kind: WorkspaceKind
    key: string
    refs: Array<{ kind: WorkspaceKind; key: string }>
  }> = []
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
        error(
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
      if (parsed.decl !== undefined) {
        desired.set(key, parsed.decl)
        references.push({ kind, key, refs: adapter.codec.refs?.(parsed.decl) ?? [] })
      }
    }
    diagnostics.push(...kindFindings)
    if (kind === 'workflow') declaredWorkflows = desired
    /** A resource that failed to parse would read as undeclared, so a broken kind is not planned. */
    if (kindFindings.some((finding) => finding.severity === 'error')) continue
    try {
      const stored = await adapter.load(ctx, { allocate: false })
      changes.push(...(await adapter.plan(desired, stored, planCtx)))
    } catch (caught) {
      diagnostics.push(refusalDiagnostic(caught, { kind }))
    }
  }

  await checkDeletesInUse(changes, declaredWorkflows, workspaceId)
  const deleted = new Set(
    changes
      .filter((change) => change.action === 'delete')
      .map((change) => resourceAddress(change.kind, change.key))
  )
  for (const { kind, key, refs } of references) {
    for (const ref of refs) {
      if (!deleted.has(resourceAddress(ref.kind, ref.key))) continue
      diagnostics.push(
        error(
          'E_PLAN_REF_DELETED',
          `${KIND_DIRS[kind]}/${key} uses ${ref.kind} "${ref.key}", which this apply deletes.`,
          {
            kind,
            key,
            hint: `Keep ${KIND_DIRS[ref.kind]}/${ref.key}, or stop using it first.`,
          }
        )
      )
    }
  }

  const writes = changes.filter((change) => change.action !== 'noop')
  if (writes.length > WORKSPACE_SOURCE_LIMITS.maxChanges) {
    diagnostics.push(
      error(
        'E_PLAN_TOO_LARGE',
        `The apply makes ${writes.length} changes, over the ${WORKSPACE_SOURCE_LIMITS.maxChanges}-change limit.`
      )
    )
  }
  for (const change of writes) {
    if (change.diagnostics.some((finding) => finding.severity === 'error')) continue
    try {
      await KIND_ADAPTERS[change.kind].authorize(change, ctx)
    } catch (caught) {
      change.diagnostics.push(refusalDiagnostic(caught, { kind: change.kind, key: change.key }))
    }
  }
  for (const change of changes) diagnostics.push(...change.diagnostics)

  const sent = new Set(
    [...blobs.byPath.values()].filter((blob) => blob.content !== undefined).map((blob) => blob.path)
  )
  const needBlobs = [
    ...new Set(
      writes.flatMap((change) => change.needsBlobs ?? []).filter((path) => !sent.has(path))
    ),
  ]
  return { changes, diagnostics, base, needBlobs, carried: blobs.carried }
}
