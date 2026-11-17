/**
 * Workflows as workspace source: each `workflows/<key>/` folder is a workflow source directory,
 * applied through the workflow source pipeline (`applyWorkflowSource`, `createWorkflowFromSource`)
 * and archived through `deleteWorkflow`, so compile, gates, locks, the per-workflow fingerprint
 * (409) and audit are exactly a single-workflow apply's. Folder placement is not managed.
 *
 * The kind's rule differs from the three-way rule the other kinds share, on purpose:
 * - An edited folder is checked against its own `.sim/base.json` (the single-workflow apply's
 *   409, re-checked under the workflow row lock), which keeps the folder appliable on its own with
 *   `sim workflows source apply`. The root base's fingerprint only guards a delete.
 * - A folder sent unchanged (only its base, `isUnchanged`) is a no-op with no drift check, so it
 *   never reports `I_SERVER_CHANGED`. The workflow's fingerprint hashes its canonicalized stored
 *   graph, so telling whether it drifted means reading and canonicalizing every declared workflow
 *   on every apply, the cost the unchanged folder exists to avoid; no cheaper stored token tracks
 *   it (the row's `updatedAt` also moves on a drag or a resize, which source never shows). The
 *   change is never lost: the next get prints it, and an edit of the folder is refused as stale.
 */
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { parseWorkflowLock, type SourceBase, type WorkflowLockV1 } from '@sim/workflow-code'
import { SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import {
  type BaseResource,
  fingerprintOf,
  isWorkspaceKind,
  type ResourceFingerprint,
  resourceAddress,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { isResourceKeyed } from '@sim/workspace-code/kinds/registry'
import {
  type WorkflowDecl,
  workflowCodec,
  workflowFolder,
  workflowSourceBase,
} from '@sim/workspace-code/kinds/workflow'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  applyWorkflowSource,
  createWorkflowFromSource,
} from '@/lib/workflows/application/apply-workflow-source'
import { deleteWorkflow } from '@/lib/workflows/application/delete-workflow'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import type { SourceDiffSummary } from '@/lib/workflows/application/source-diff'
import { WorkflowSourceRejectedError } from '@/lib/workflows/application/source-error'
import type { PendingResource } from '@/lib/workflows/application/source-evaluate'
import {
  countLiveWorkflows,
  LAST_WORKFLOW_MESSAGE,
} from '@/lib/workflows/orchestration/workflow-lifecycle'
import {
  refusalDiagnostic,
  WorkspaceSourceRejectedError,
} from '@/lib/workspace-source/application/errors'
import {
  kindFinding,
  noBaseFinding,
  planUndeclared,
  serverGoneFinding,
} from '@/lib/workspace-source/application/findings'
import { bindStored, listUpTo, pendingOf } from '@/lib/workspace-source/application/keys'
import type {
  KindAdapter,
  PlanContext,
  PlannedChange,
  SourceContext,
  StoredSet,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'
import type { ResourceKeyRef } from '@/lib/workspaces/resource-keys'

const logger = createLogger('WorkspaceSourceWorkflows')

/** Workflows per page while listing a workspace's workflows. */
const LIST_PAGE = 200

/** Undeclared workflows a plan reads at once to fingerprint them for a delete. */
const FINGERPRINT_CONCURRENCY = 4

/**
 * The root base's fingerprint of a workflow: its stored source fingerprint (`sf1:`), so a delete
 * can tell the workflow changed since the directory read it, as an edit's own `base` does.
 */
function workflowFingerprint(source: SourceBase): ResourceFingerprint {
  return fingerprintOf({ source: source.fingerprint })
}

/** The fingerprint of workflow `workflowId` as it is stored now. */
async function currentFingerprint(
  ctx: SourceContext,
  workflowId: string
): Promise<ResourceFingerprint> {
  const source = await readWorkflowSource.execute({
    principal: ctx.principal,
    input: { workflowId },
  })
  return workflowFingerprint(source.base)
}

/** A stored workflow carries nothing beyond its id and name: the pipeline reads the rest. */
type StoredWorkflowState = null

/** What an update applies, decided at plan time: the folder's validated lock and base. */
interface WorkflowPlan {
  lock: WorkflowLockV1
  base: SourceBase
}

type WorkflowChange = PlannedChange<WorkflowDecl, WorkflowPlan>

/**
 * The resources a compiled workflow names that a workspace directory declares by the same key: a
 * kind whose source key is its resource key (a workspace file's source key is its path).
 */
function sourceRefs(references: readonly ResourceKeyRef[]): NonNullable<WorkflowChange['refs']> {
  const refs = new Map<string, { kind: WorkspaceKind; key: string }>()
  for (const { kind, key } of references) {
    if (isWorkspaceKind(kind) && isResourceKeyed(kind)) refs.set(`${kind}:${key}`, { kind, key })
  }
  return [...refs.values()]
}

/** A workflow pipeline finding, pinned to its file in the workspace directory. */
function inFolder(
  key: string,
  diagnostics: ReadonlyArray<Omit<WorkspaceSourceDiagnostic, 'kind' | 'key'>>
): WorkspaceSourceDiagnostic[] {
  return diagnostics.map((finding) => ({
    ...finding,
    ...(finding.file !== undefined ? { file: `${workflowFolder(key)}/${finding.file}` } : {}),
    kind: 'workflow',
    key,
  }))
}

/** `blocks +2 -1 ~3, connections +1`: what a workflow apply changes, for the plan display. */
function diffFields(diff: SourceDiffSummary): string[] {
  const { blocks, edges, variables } = diff
  const fields: string[] = []
  if (blocks.added.length > 0) fields.push(`blocks +${blocks.added.length}`)
  if (blocks.removed.length > 0) fields.push(`blocks -${blocks.removed.length}`)
  if (blocks.renamed.length > 0) fields.push(`blocks renamed ${blocks.renamed.length}`)
  for (const block of blocks.modified) fields.push(`${block.key}: ${block.fields.join(', ')}`)
  if (edges.added + edges.removed > 0) fields.push(`connections +${edges.added} -${edges.removed}`)
  const changedVariables =
    variables.added.length + variables.removed.length + variables.modified.length
  if (changedVariables > 0) fields.push(`variables ${changedVariables}`)
  return fields
}

/** The folder's lock, or the findings that refuse it, pinned to `.sim/lock.json`. */
function readLock(
  key: string,
  decl: WorkflowDecl
): { lock: WorkflowLockV1 } | { diagnostics: WorkspaceSourceDiagnostic[] } {
  if (decl.lock === undefined) return { lock: { version: 1, blocks: {}, variables: {} } }
  const parsed = parseWorkflowLock(decl.lock)
  if (parsed.lock) return { lock: parsed.lock }
  return {
    diagnostics: parsed.diagnostics.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      file: `${workflowFolder(key)}/${SOURCE_LOCK_FILE}`,
      ...(finding.path !== undefined ? { path: finding.path } : {}),
      kind: 'workflow',
      key,
    })),
  }
}

/**
 * Plans one workflow folder. `pending` holds the resources earlier kinds and folders of this apply
 * create or adopt, which the dry run resolves; a created workflow carries its own entry, so a
 * later folder naming it resolves too.
 */
async function planWorkflow(
  key: string,
  decl: WorkflowDecl,
  stored: StoredSet<StoredWorkflowState>,
  ctx: PlanContext,
  pending: readonly PendingResource[]
): Promise<WorkflowChange> {
  const change: WorkflowChange = { kind: 'workflow', key, action: 'noop', decl, diagnostics: [] }
  const { principal } = ctx
  const workspaceId = ctx.workspace.workspaceId
  const base = workflowSourceBase(decl)
  const existing =
    base && base.workspaceId === workspaceId
      ? [...stored.bound.values(), ...stored.unbound].find(
          (workflow) => workflow.id === base.workflowId
        )
      : undefined
  const holder = stored.bound.get(key)
  if (holder && holder.id !== existing?.id) {
    change.diagnostics.push(
      existing
        ? kindFinding(
            'workflow',
            key,
            'E_NAME_TAKEN',
            `The workflow key "${key}" belongs to "${holder.name}", not the workflow this folder was read from.`,
            { hint: 'Rename the folder back to the key it was read under.' }
          )
        : noBaseFinding('workflow', key)
    )
    return change
  }
  const unchanged = Object.keys(decl.files).length === 0
  if (unchanged && existing) return { ...change, storedId: existing.id }
  // The folder's base names a workflow of this workspace the server no longer holds.
  if (!existing && base?.workspaceId === workspaceId) {
    change.diagnostics.push(serverGoneFinding('workflow', key, !unchanged))
    return change
  }
  if (unchanged) {
    change.diagnostics.push(
      kindFinding(
        'workflow',
        key,
        'E_WORKFLOW_FILES_MISSING',
        `${workflowFolder(key)} was sent unchanged, but its base names no workflow of this workspace.`,
        { hint: 'Edit the folder so the apply sends its files and creates the workflow here.' }
      )
    )
    return change
  }
  try {
    if (existing && base) {
      const read = readLock(key, decl)
      if ('diagnostics' in read) {
        change.diagnostics.push(...read.diagnostics)
        return change
      }
      const result = await applyWorkflowSource.execute({
        principal,
        input: {
          workflowId: existing.id,
          files: decl.files,
          lock: read.lock,
          base,
          dryRun: true,
          pendingResources: pending,
        },
      })
      change.diagnostics.push(...inFolder(key, result.diagnostics))
      // A graph no-op that changes only idents, order or comments still writes its source meta.
      const metaOnly = result.diff.noop && result.sourceMetaChanged
      return {
        ...change,
        action: result.diff.noop && !metaOnly ? 'noop' : 'update',
        storedId: existing.id,
        fields: metaOnly ? ['names, order or comments'] : diffFields(result.diff),
        refs: sourceRefs(result.references),
        detail: { lock: read.lock, base },
      }
    }
    const result = await createWorkflowFromSource.execute({
      principal,
      input: { workspaceId, files: decl.files, dryRun: true, pendingResources: pending },
    })
    change.diagnostics.push(...inFolder(key, result.diagnostics))
    return {
      ...change,
      action: 'create',
      pending: pendingOf({ ...change, action: 'create' }),
      fields: diffFields(result.diff),
      refs: sourceRefs(result.references),
    }
  } catch (error) {
    change.diagnostics.push(refusalDiagnostic(error, { kind: 'workflow', key }))
    return change
  }
}

/**
 * Refuses every planned delete when, with the workflows this apply creates, they would leave the
 * workspace no live workflow: the delete use case refuses its last workflow, so the plan says so
 * before anything is written. Creates are written before deletes, so a create counts.
 */
async function refuseDeletingEveryWorkflow(
  changes: WorkflowChange[],
  ctx: PlanContext
): Promise<void> {
  const deletes = changes.filter((change) => change.action === 'delete')
  if (deletes.length === 0) return
  const created = changes.filter((change) => change.action === 'create').length
  const live = await countLiveWorkflows(ctx.workspace.workspaceId)
  if (live + created - deletes.length >= 1) return
  for (const change of deletes) {
    change.action = 'noop'
    change.diagnostics.push(
      kindFinding('workflow', change.key, 'E_APPLY_REFUSED', LAST_WORKFLOW_MESSAGE, {
        hint: 'Keep one workflow declared, or add another before deleting this one.',
      })
    )
  }
}

export const workflowAdapter: KindAdapter<WorkflowDecl, StoredWorkflowState, WorkflowPlan> = {
  codec: workflowCodec,
  keys: 'every-write',

  async load(ctx, { allocate }) {
    const { workspaceId } = ctx.workspace
    type CursorKeys = Awaited<ReturnType<typeof listWorkflows.execute>>['nextCursorKeys']
    const workflows = await listUpTo(async (cursorKeys: CursorKeys | undefined) => {
      const page = await listWorkflows.execute({
        principal: ctx.principal,
        input: {
          workspaceId,
          scope: 'active',
          deployedOnly: false,
          sortBy: 'createdAt',
          sortOrder: 'asc',
          limit: LIST_PAGE,
          ...(cursorKeys ? { cursorKeys } : {}),
        },
      })
      return { items: page.workflows, next: page.nextCursorKeys }
    })
    const records = workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      state: null,
    }))
    return bindStored(ctx, 'workflow', records, { allocate })
  },

  async plan(desired, stored, ctx) {
    const changes: WorkflowChange[] = []
    for (const [key, decl] of desired) {
      const pending = [...ctx.pending, ...changes.flatMap((change) => change.pending ?? [])]
      changes.push(await planWorkflow(key, decl, stored, ctx, pending))
    }
    // A delete is stale when the workflow changed on the server since the base recorded it; one
    // that cannot be read now never matches, so it is refused rather than deleted unseen.
    const fingerprints = new Map<string, string>()
    if (ctx.allowDelete) {
      const claimed = new Set(changes.map((change) => change.storedId))
      const candidates = [...stored.bound].filter(
        ([key, workflow]) =>
          !desired.has(key) &&
          !claimed.has(workflow.id) &&
          ctx.base?.resources[resourceAddress('workflow', key)]?.id === workflow.id
      )
      await mapWithConcurrency(candidates, FINGERPRINT_CONCURRENCY, async ([, workflow]) => {
        try {
          fingerprints.set(workflow.id, await currentFingerprint(ctx, workflow.id))
        } catch (error) {
          logger.warn('Could not read a workflow to fingerprint its delete', {
            workflowId: workflow.id,
            error: getErrorMessage(error),
          })
        }
      })
    }
    changes.push(
      ...planUndeclared<StoredWorkflowState, WorkflowDecl, WorkflowPlan>(
        'workflow',
        desired,
        stored,
        ctx,
        {
          declared: changes,
          fingerprint: (workflow) => fingerprints.get(workflow.id) ?? '',
        }
      )
    )
    await refuseDeletingEveryWorkflow(changes, ctx)
    return changes
  },

  async authorize(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    if (change.action === 'create' && change.decl) {
      await createWorkflowFromSource.authorize({
        principal,
        input: { workspaceId, files: change.decl.files },
      })
      return
    }
    if (!change.storedId) return
    if (change.action === 'delete') {
      await deleteWorkflow.authorize({ principal, input: { workflowId: change.storedId } })
      return
    }
    if (change.decl && change.detail) {
      await applyWorkflowSource.authorize({
        principal,
        input: { workflowId: change.storedId, ...change.detail, files: change.decl.files },
      })
    }
  },

  async fingerprintNow(change, ctx) {
    if (!change.storedId) throw new Error('A workflow check needs the stored workflow id')
    return currentFingerprint(ctx, change.storedId)
  },

  async apply(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    if (change.action === 'delete') {
      if (!change.storedId) throw new Error('A workflow delete needs the stored workflow id')
      await deleteWorkflow.execute({ principal, input: { workflowId: change.storedId } })
      return { id: change.storedId, text: {} }
    }
    const decl = change.decl
    if (!decl) throw new Error('A workflow write needs its files')
    const provenance = ctx.provenance ? { provenance: ctx.provenance } : {}
    const plan = change.detail
    if (change.action !== 'create' && (!plan || !change.storedId)) {
      throw new Error('A workflow update needs its plan')
    }
    const write = () =>
      plan && change.storedId
        ? applyWorkflowSource.execute({
            principal,
            input: { workflowId: change.storedId, ...plan, files: decl.files, ...provenance },
          })
        : createWorkflowFromSource.execute({
            principal,
            input: { workspaceId, files: decl.files, ...provenance },
          })
    // The pipeline's own refusal is the apply's, with its findings pinned to the folder.
    const result = await write().catch((error: unknown) => {
      if (!(error instanceof WorkflowSourceRejectedError)) throw error
      throw new WorkspaceSourceRejectedError(inFolder(change.key, error.diagnostics))
    })
    const base: BaseResource = {
      id: result.workflowId,
      fingerprint: workflowFingerprint(result.base),
    }
    return {
      id: result.workflowId,
      base,
      text: workflowCodec.print(change.key, {
        files: result.files,
        lock: result.lock,
        base: result.base,
      }).text,
      diagnostics: inFolder(change.key, result.diagnostics),
    }
  },

  async read(stored, ctx) {
    const source = await readWorkflowSource.execute({
      principal: ctx.principal,
      input: { workflowId: stored.id },
    })
    const printed = workflowCodec.print(stored.key, {
      files: source.files,
      lock: source.lock,
      base: source.base,
    })
    return {
      text: printed.text,
      blobs: [],
      base: { id: stored.id, fingerprint: workflowFingerprint(source.base) },
      diagnostics: inFolder(stored.key, source.diagnostics),
    }
  },
}
